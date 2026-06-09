-- =============================================================
-- FaithOn — Initial Supabase schema
-- Run via: Supabase Dashboard → SQL Editor → Run
-- Or:      supabase db push  (Supabase CLI)
-- Idempotent: safe to re-run (uses IF NOT EXISTS / DO blocks).
-- =============================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";

-- ---------- ENUMS ----------
do $$ begin
  create type user_tier as enum ('free', 'plus');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum (
    'trialing','active','past_due','canceled','unpaid',
    'incomplete','incomplete_expired','paused'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_role as enum ('user','companion','system');
exception when duplicate_object then null; end $$;

-- ---------- updated_at trigger function ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================
-- USERS — phone is the primary identity (SMS-first)
-- =============================================================
create table if not exists public.users (
  id                  uuid primary key default gen_random_uuid(),
  phone_e164          text not null unique
                        check (phone_e164 ~ '^\+[1-9]\d{6,14}$'),
  first_name          text,
  timezone            text not null default 'America/New_York',
  locale              text not null default 'en',
  tier                user_tier not null default 'free',
  stripe_customer_id  text unique,
  consent_marketing   boolean not null default false,
  consent_pastoral    boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_active_at      timestamptz,
  deleted_at          timestamptz
);

create index if not exists idx_users_phone
  on public.users(phone_e164) where deleted_at is null;
create index if not exists idx_users_tier
  on public.users(tier) where deleted_at is null;
create index if not exists idx_users_stripe
  on public.users(stripe_customer_id) where stripe_customer_id is not null;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
  for each row execute function set_updated_at();

comment on table public.users is
  'SMS subscribers. tier column drives content delivery in the SMS handler.';
comment on column public.users.tier is
  'Denormalized from subscriptions for fast O(1) tier check per inbound SMS.';

-- =============================================================
-- SUBSCRIPTIONS — Stripe mirror, updated by webhook
-- =============================================================
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null
                             references public.users(id) on delete cascade,
  stripe_subscription_id   text not null unique,
  stripe_price_id          text not null,
  stripe_product_id        text,
  status                   subscription_status not null,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  canceled_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_subscriptions_user
  on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status
  on public.subscriptions(status);
create index if not exists idx_subscriptions_period_end
  on public.subscriptions(current_period_end);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at before update on public.subscriptions
  for each row execute function set_updated_at();

-- =============================================================
-- CONVERSATIONS + MESSAGES — full chat history
-- =============================================================
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  title           text,
  archived        boolean not null default false,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists idx_conversations_user
  on public.conversations(user_id, last_message_at desc);

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null
                       references public.conversations(id) on delete cascade,
  user_id            uuid not null
                       references public.users(id) on delete cascade,
  role               message_role not null,
  content            text not null,
  verse_reference    text,
  tokens_used        integer,
  twilio_message_sid text unique,
  created_at         timestamptz not null default now()
);
create index if not exists idx_messages_conversation
  on public.messages(conversation_id, created_at);
create index if not exists idx_messages_user_recent
  on public.messages(user_id, created_at desc);

-- =============================================================
-- DAILY USAGE — enforces 5/day limit on free tier
-- =============================================================
create table if not exists public.daily_usage (
  user_id       uuid not null
                  references public.users(id) on delete cascade,
  usage_date    date not null default current_date,
  message_count integer not null default 0,
  primary key (user_id, usage_date)
);

comment on table public.daily_usage is
  'Rate limit counter. Free tier capped at 5 messages/day; Plus unlimited.';

-- =============================================================
-- PRAYER REQUESTS
-- =============================================================
create table if not exists public.prayer_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  content      text not null,
  category     text,
  is_private   boolean not null default true,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_prayer_user
  on public.prayer_requests(user_id, created_at desc);

-- =============================================================
-- CONTENT LIBRARIES — devotionals + verses
-- =============================================================
create table if not exists public.devotionals (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  body              text not null,
  verse_reference   text,
  season            text,
  audience          text not null default 'all'
                      check (audience in ('all','plus_only')),
  publish_for_date  date,
  created_at        timestamptz not null default now()
);
create index if not exists idx_devotionals_date
  on public.devotionals(publish_for_date) where publish_for_date is not null;
create index if not exists idx_devotionals_audience
  on public.devotionals(audience);

comment on column public.devotionals.audience is
  'all = sent to everyone; plus_only = personalized depth for paying users.';

create table if not exists public.verses (
  id          uuid primary key default gen_random_uuid(),
  reference   text not null,
  text        text not null,
  translation text not null default 'NIV',
  themes      text[] not null default '{}',
  unique (reference, translation)
);
create index if not exists idx_verses_themes
  on public.verses using gin(themes);

-- =============================================================
-- STRIPE WEBHOOK EVENTS — idempotency log
-- =============================================================
create table if not exists public.stripe_webhook_events (
  id            text primary key,        -- Stripe event.id
  type          text not null,
  payload       jsonb not null,
  processed_at  timestamptz,
  received_at   timestamptz not null default now()
);
create index if not exists idx_webhook_unprocessed
  on public.stripe_webhook_events(received_at) where processed_at is null;

-- =============================================================
-- AUDIT LOG
-- =============================================================
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete set null,
  action      text not null,
  metadata    jsonb not null default '{}',
  ip_address  inet,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_user
  on public.audit_log(user_id, created_at desc);
create index if not exists idx_audit_action
  on public.audit_log(action, created_at desc);

-- =============================================================
-- VIEW: active_subscribers
-- =============================================================
create or replace view public.active_subscribers as
select
  u.id,
  u.phone_e164,
  u.first_name,
  u.tier,
  s.status,
  s.current_period_end,
  s.cancel_at_period_end
from public.users u
join public.subscriptions s on s.user_id = u.id
where u.deleted_at is null
  and s.status in ('active','trialing');

-- =============================================================
-- FUNCTION: is_phone_plus(phone) — one-call tier check
-- =============================================================
create or replace function public.is_phone_plus(p_phone text)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.users u
    join public.subscriptions s on s.user_id = u.id
    where u.phone_e164 = p_phone
      and u.deleted_at is null
      and s.status in ('active','trialing')
      and s.current_period_end > now()
  );
$$;

comment on function public.is_phone_plus(text) is
  'Returns true if the phone has a currently-active Plus subscription. '
  'Call this from the SMS handler on every inbound message.';

-- =============================================================
-- ROW LEVEL SECURITY
-- Service role (server backend) bypasses RLS automatically.
-- Policies below scope end-user access for a future user portal.
-- =============================================================
alter table public.users                  enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.conversations          enable row level security;
alter table public.messages               enable row level security;
alter table public.daily_usage            enable row level security;
alter table public.prayer_requests        enable row level security;
alter table public.devotionals            enable row level security;
alter table public.verses                 enable row level security;
alter table public.stripe_webhook_events  enable row level security;
alter table public.audit_log              enable row level security;

drop policy if exists "devotionals_read_all" on public.devotionals;
create policy "devotionals_read_all" on public.devotionals
  for select to authenticated using (true);

drop policy if exists "verses_read_all" on public.verses;
create policy "verses_read_all" on public.verses
  for select to authenticated using (true);

drop policy if exists "users_self_select" on public.users;
create policy "users_self_select" on public.users
  for select to authenticated using (auth.uid() = id);

drop policy if exists "users_self_update" on public.users;
create policy "users_self_update" on public.users
  for update to authenticated using (auth.uid() = id);

drop policy if exists "subscriptions_self" on public.subscriptions;
create policy "subscriptions_self" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "conversations_self" on public.conversations;
create policy "conversations_self" on public.conversations
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "messages_self" on public.messages;
create policy "messages_self" on public.messages
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "daily_usage_self" on public.daily_usage;
create policy "daily_usage_self" on public.daily_usage
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "prayer_requests_self" on public.prayer_requests;
create policy "prayer_requests_self" on public.prayer_requests
  for all to authenticated using (auth.uid() = user_id);

drop policy if exists "audit_self" on public.audit_log;
create policy "audit_self" on public.audit_log
  for select to authenticated using (auth.uid() = user_id);

-- Webhook events: service role only (no policy = blocked for
-- authenticated/anon when RLS is enabled).

-- =============================================================
-- SANITY CHECK — uncomment after run
-- =============================================================
-- select table_name from information_schema.tables
-- where table_schema = 'public' order by table_name;
-- select * from public.is_phone_plus('+15551234567');

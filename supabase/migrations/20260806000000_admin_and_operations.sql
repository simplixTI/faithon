-- =============================================================
-- FaithOn — Phase 1: Admin, Entitlements, Operations
-- =============================================================
-- Adds the schema needed for the backoffice, cost accounting,
-- Twilio/OpenAI/n8n mirroring, and RLS with real admin roles.
--
-- Safe to re-run: uses IF NOT EXISTS / DO blocks / ON CONFLICT.
--
-- Requires the initial schema (20260609000000_initial_schema.sql).
-- =============================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------- shared updated_at trigger ----------
create or replace function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- =============================================================
-- ENUMS
-- =============================================================
do $$ begin
  create type public.admin_role as enum ('super_admin','support_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.access_status as enum (
    'trial','active','free','past_due','grace_period',
    'blocked','opted_out','deleted'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sms_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sms_status as enum (
    'queued','sending','sent','delivered','undelivered','failed',
    'received','read'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.workflow_status as enum (
    'running','success','failed','timeout','skipped'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_severity as enum ('info','warning','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_status as enum ('open','acknowledged','resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.system_component as enum (
    'twilio','stripe','n8n','openai','database','api','cron'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deletion_status as enum (
    'requested','processing','completed','rejected'
  );
exception when duplicate_object then null; end $$;

-- =============================================================
-- Extend public.users (denormalized hot-path fields for SMS handler)
-- =============================================================
alter table public.users
  add column if not exists access_status public.access_status not null default 'free',
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists grace_period_ends_at timestamptz,
  add column if not exists source text default 'sms',
  add column if not exists daily_limit_override integer,
  add column if not exists blocked_reason text,
  add column if not exists last_message_at timestamptz;

create index if not exists idx_users_access_status
  on public.users(access_status) where deleted_at is null;
create index if not exists idx_users_trial_ends
  on public.users(trial_ends_at) where trial_ends_at is not null;
create index if not exists idx_users_grace_ends
  on public.users(grace_period_ends_at) where grace_period_ends_at is not null;

-- =============================================================
-- Rename daily_usage → usage_daily (spec naming) and extend
-- =============================================================
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='daily_usage')
     and not exists (select 1 from information_schema.tables
                     where table_schema='public' and table_name='usage_daily') then
    alter table public.daily_usage rename to usage_daily;
  end if;
end $$;

create table if not exists public.usage_daily (
  user_id uuid not null references public.users(id) on delete cascade,
  usage_date date not null default current_date,
  message_count integer not null default 0,
  primary key (user_id, usage_date)
);

alter table public.usage_daily
  add column if not exists inbound_count integer not null default 0,
  add column if not exists outbound_count integer not null default 0,
  add column if not exists ai_tokens_input integer not null default 0,
  add column if not exists ai_tokens_output integer not null default 0,
  add column if not exists estimated_cost_cents numeric(10,4) not null default 0;

create index if not exists idx_usage_daily_date
  on public.usage_daily(usage_date desc);

-- monthly rollup
create table if not exists public.usage_monthly (
  user_id uuid not null references public.users(id) on delete cascade,
  year_month text not null check (year_month ~ '^\d{4}-\d{2}$'),
  inbound_count integer not null default 0,
  outbound_count integer not null default 0,
  ai_tokens_input integer not null default 0,
  ai_tokens_output integer not null default 0,
  estimated_cost_cents numeric(12,4) not null default 0,
  primary key (user_id, year_month)
);
create index if not exists idx_usage_monthly_ym
  on public.usage_monthly(year_month desc);

-- =============================================================
-- plans (config-driven; free is DB-only, no Stripe row)
-- =============================================================
create table if not exists public.plans (
  slug text primary key,
  name text not null,
  is_paid boolean not null default false,
  price_cents integer not null default 0,
  currency text not null default 'usd',
  daily_message_limit integer,       -- null = unlimited (subject to fair use)
  features jsonb not null default '{}'::jsonb,
  stripe_product_id text,
  stripe_price_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

-- =============================================================
-- app_settings — key/value config; secrets NEVER live here
-- =============================================================
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  category text not null default 'general',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- =============================================================
-- admin_users — mirror of auth.users, gated by role
-- =============================================================
create table if not exists public.admin_users (
  id uuid primary key,               -- matches auth.users.id
  email citext not null unique,
  role public.admin_role not null default 'support_admin',
  full_name text,
  active boolean not null default true,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at before update on public.admin_users
  for each row execute function public.set_updated_at();

-- FK to auth.users only if auth schema exists (Supabase managed)
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    if not exists (
      select 1 from information_schema.table_constraints
      where constraint_name = 'admin_users_id_fkey'
        and table_schema = 'public' and table_name = 'admin_users'
    ) then
      alter table public.admin_users
        add constraint admin_users_id_fkey
        foreign key (id) references auth.users(id) on delete cascade;
    end if;
  end if;
end $$;

-- =============================================================
-- Admin role helper functions (RLS-friendly)
-- =============================================================
create or replace function public.is_admin(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.admin_users
    where id = p_uid and active
  );
$$;

create or replace function public.is_super_admin(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.admin_users
    where id = p_uid and active and role = 'super_admin'
  );
$$;

comment on function public.is_admin(uuid) is
  'RLS helper: true if given auth uid is an active admin (any role).';
comment on function public.is_super_admin(uuid) is
  'RLS helper: true if given auth uid is an active super_admin.';

-- =============================================================
-- admin_audit_logs — every admin action, immutable
-- =============================================================
create table if not exists public.admin_audit_logs (
  id bigserial primary key,
  admin_id uuid references public.admin_users(id) on delete set null,
  admin_email citext,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_audit_admin
  on public.admin_audit_logs(admin_id, created_at desc);
create index if not exists idx_admin_audit_target
  on public.admin_audit_logs(target_type, target_id, created_at desc);
create index if not exists idx_admin_audit_action
  on public.admin_audit_logs(action, created_at desc);

-- =============================================================
-- user_consents — SMS opt-in/opt-out compliance (10DLC / TCPA)
-- =============================================================
create table if not exists public.user_consents (
  user_id uuid primary key references public.users(id) on delete cascade,
  opt_in boolean not null default false,
  opt_in_at timestamptz,
  opt_in_source text,                -- e.g. 'sms:PRAY', 'web'
  opt_out boolean not null default false,
  opt_out_at timestamptz,
  opt_out_reason text,               -- 'STOP' etc
  consent_marketing boolean not null default false,
  consent_pastoral boolean not null default true,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_user_consents_updated_at on public.user_consents;
create trigger trg_user_consents_updated_at before update on public.user_consents
  for each row execute function public.set_updated_at();

-- =============================================================
-- user_entitlements — source of truth for access state
-- =============================================================
create table if not exists public.user_entitlements (
  user_id uuid primary key references public.users(id) on delete cascade,
  plan_slug text not null references public.plans(slug),
  access_status public.access_status not null,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  grace_period_ends_at timestamptz,
  daily_limit_override integer,
  notes text,
  updated_by uuid references public.admin_users(id),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_user_entitlements_updated_at on public.user_entitlements;
create trigger trg_user_entitlements_updated_at before update on public.user_entitlements
  for each row execute function public.set_updated_at();
create index if not exists idx_user_entitlements_status
  on public.user_entitlements(access_status);
create index if not exists idx_user_entitlements_trial
  on public.user_entitlements(trial_ends_at) where trial_ends_at is not null;
create index if not exists idx_user_entitlements_grace
  on public.user_entitlements(grace_period_ends_at) where grace_period_ends_at is not null;

-- =============================================================
-- subscription_events — subscription lifecycle audit
-- =============================================================
create table if not exists public.subscription_events (
  id bigserial primary key,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  stripe_subscription_id text,
  user_id uuid references public.users(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  stripe_event_id text,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_sub_events_user
  on public.subscription_events(user_id, occurred_at desc);
create index if not exists idx_sub_events_sub
  on public.subscription_events(subscription_id, occurred_at desc);

-- =============================================================
-- payment_events — every invoice/charge attempt
-- =============================================================
create table if not exists public.payment_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  stripe_invoice_id text,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  amount_cents integer,
  currency text default 'usd',
  status text not null,              -- succeeded, failed, requires_action, etc
  failure_code text,
  failure_message text,
  billing_reason text,
  attempt_count integer,
  stripe_event_id text,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_payment_events_user
  on public.payment_events(user_id, occurred_at desc);
create index if not exists idx_payment_events_status
  on public.payment_events(status, occurred_at desc);
create unique index if not exists uq_payment_events_stripe_event
  on public.payment_events(stripe_event_id) where stripe_event_id is not null;

-- =============================================================
-- sms_messages — every SMS in/out (Twilio mirror)
-- =============================================================
create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  direction public.sms_direction not null,
  from_e164 text,
  to_e164 text,
  body text,
  twilio_message_sid text unique,
  provider text not null default 'twilio',
  num_segments integer,
  status public.sms_status,
  error_code text,
  error_message text,
  price_cents numeric(10,4),
  price_currency text default 'usd',
  command text,                      -- PRAY/HELP/STOP/START/UNSTOP (uppercased)
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
create index if not exists idx_sms_user
  on public.sms_messages(user_id, created_at desc);
create index if not exists idx_sms_direction
  on public.sms_messages(direction, created_at desc);
create index if not exists idx_sms_status
  on public.sms_messages(status, created_at desc);
create index if not exists idx_sms_command
  on public.sms_messages(command) where command is not null;
create index if not exists idx_sms_created_at
  on public.sms_messages(created_at desc);

-- =============================================================
-- sms_webhook_events — raw Twilio events (idempotency)
-- =============================================================
create table if not exists public.sms_webhook_events (
  id text primary key,               -- Twilio EventSid or MessageSid+status
  type text not null,                -- 'inbound' | 'status_callback'
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create index if not exists idx_sms_webhook_unprocessed
  on public.sms_webhook_events(received_at) where processed_at is null;

-- =============================================================
-- ai_usage_events — OpenAI token/cost accounting
-- =============================================================
create table if not exists public.ai_usage_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  provider text not null default 'openai',
  model text not null,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  latency_ms integer,
  estimated_cost_cents numeric(10,4) not null default 0,
  safety_blocked boolean not null default false,
  fallback_used boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_usage_user
  on public.ai_usage_events(user_id, created_at desc);
create index if not exists idx_ai_usage_model
  on public.ai_usage_events(model, created_at desc);
create index if not exists idx_ai_usage_created
  on public.ai_usage_events(created_at desc);

-- =============================================================
-- workflow_executions — n8n heartbeats + executions
-- =============================================================
create table if not exists public.workflow_executions (
  id bigserial primary key,
  workflow_name text not null,
  execution_id text,                 -- n8n execution id
  status public.workflow_status not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists idx_wf_exec_name
  on public.workflow_executions(workflow_name, started_at desc);
create index if not exists idx_wf_exec_status
  on public.workflow_executions(status, started_at desc);
create unique index if not exists uq_wf_exec_execution
  on public.workflow_executions(workflow_name, execution_id)
  where execution_id is not null;

-- =============================================================
-- system_health — latest state per component
-- =============================================================
create table if not exists public.system_health (
  component public.system_component primary key,
  last_heartbeat_at timestamptz,
  status text not null default 'unknown', -- ok | degraded | down | unknown
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_system_health_updated_at on public.system_health;
create trigger trg_system_health_updated_at before update on public.system_health
  for each row execute function public.set_updated_at();

-- =============================================================
-- system_alerts — surfaced in backoffice
-- =============================================================
create table if not exists public.system_alerts (
  id bigserial primary key,
  severity public.alert_severity not null,
  code text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  status public.alert_status not null default 'open',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.admin_users(id),
  resolved_at timestamptz,
  resolved_by uuid references public.admin_users(id)
);
create index if not exists idx_alerts_open
  on public.system_alerts(created_at desc) where status = 'open';
create index if not exists idx_alerts_code
  on public.system_alerts(code, created_at desc);

-- =============================================================
-- data_deletion_requests — privacy compliance queue
-- =============================================================
create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  phone_e164 text,                   -- kept for reconciliation after user delete
  requested_at timestamptz not null default now(),
  requested_by_admin_id uuid references public.admin_users(id),
  requested_by_email citext,
  reason text,
  status public.deletion_status not null default 'requested',
  processed_at timestamptz,
  processed_by_admin_id uuid references public.admin_users(id),
  notes text
);
create index if not exists idx_deletion_status
  on public.data_deletion_requests(status, requested_at desc);

-- =============================================================
-- DASHBOARD VIEWS — cheap reads for the /admin overview
-- =============================================================
create or replace view public.v_user_counts as
select
  count(*)                                              as total_users,
  count(*) filter (where tier = 'plus')                  as plus_users,
  count(*) filter (where tier = 'free')                  as free_users,
  count(*) filter (where access_status = 'trial')        as trial_users,
  count(*) filter (where access_status = 'blocked')      as blocked_users,
  count(*) filter (where access_status = 'opted_out')    as opted_out_users,
  count(*) filter (where created_at::date = current_date) as new_today,
  count(*) filter (where last_active_at > now() - interval '24 hours') as active_24h,
  count(*) filter (where last_active_at > now() - interval '7 days')   as active_7d,
  count(*) filter (where last_active_at > now() - interval '30 days')  as active_30d
from public.users where deleted_at is null;

create or replace view public.v_subscription_counts as
select
  count(*)                                              as total,
  count(*) filter (where status = 'active')              as active,
  count(*) filter (where status = 'trialing')            as trialing,
  count(*) filter (where status = 'past_due')            as past_due,
  count(*) filter (where status = 'unpaid')              as unpaid,
  count(*) filter (where status = 'canceled')            as canceled,
  count(*) filter (where status = 'incomplete')          as incomplete,
  count(*) filter (where status = 'incomplete_expired')  as incomplete_expired,
  count(*) filter (where status = 'paused')              as paused,
  count(*) filter (where cancel_at_period_end)           as canceling
from public.subscriptions;

-- MRR estimate: joins on stripe_price_id → plan price
create or replace view public.v_mrr as
select
  coalesce(sum(p.price_cents), 0)::numeric / 100.0 as mrr_usd,
  count(s.id)                                       as billed_subs
from public.subscriptions s
left join public.plans p on p.stripe_price_id = s.stripe_price_id
where s.status in ('active','trialing');

-- =============================================================
-- ROW LEVEL SECURITY — enable + admin-only policies
-- service_role bypasses RLS automatically (Supabase behavior).
-- =============================================================
alter table public.plans                    enable row level security;
alter table public.app_settings             enable row level security;
alter table public.admin_users              enable row level security;
alter table public.admin_audit_logs         enable row level security;
alter table public.user_consents            enable row level security;
alter table public.user_entitlements        enable row level security;
alter table public.subscription_events      enable row level security;
alter table public.payment_events           enable row level security;
alter table public.sms_messages             enable row level security;
alter table public.sms_webhook_events       enable row level security;
alter table public.usage_daily              enable row level security;
alter table public.usage_monthly            enable row level security;
alter table public.ai_usage_events          enable row level security;
alter table public.workflow_executions      enable row level security;
alter table public.system_health            enable row level security;
alter table public.system_alerts            enable row level security;
alter table public.data_deletion_requests   enable row level security;

-- plans: authenticated read (for pricing/checkout UI), super_admin write
drop policy if exists "plans_read_auth" on public.plans;
create policy "plans_read_auth" on public.plans
  for select to authenticated using (active);

drop policy if exists "plans_write_super" on public.plans;
create policy "plans_write_super" on public.plans
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- app_settings: admin read, super_admin write
drop policy if exists "app_settings_read_admin" on public.app_settings;
create policy "app_settings_read_admin" on public.app_settings
  for select to authenticated using (public.is_admin());

drop policy if exists "app_settings_write_super" on public.app_settings;
create policy "app_settings_write_super" on public.app_settings
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- admin_users: self-read + admin-read; super_admin manages
drop policy if exists "admin_users_self_read" on public.admin_users;
create policy "admin_users_self_read" on public.admin_users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "admin_users_super_manage" on public.admin_users;
create policy "admin_users_super_manage" on public.admin_users
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- admin_audit_logs: admin read (writes via service_role only)
drop policy if exists "admin_audit_read_admin" on public.admin_audit_logs;
create policy "admin_audit_read_admin" on public.admin_audit_logs
  for select to authenticated using (public.is_admin());

-- user_consents / entitlements: admin read; entitlements updatable by admin
drop policy if exists "user_consents_admin_read" on public.user_consents;
create policy "user_consents_admin_read" on public.user_consents
  for select to authenticated using (public.is_admin());

drop policy if exists "user_entitlements_admin_read" on public.user_entitlements;
create policy "user_entitlements_admin_read" on public.user_entitlements
  for select to authenticated using (public.is_admin());

drop policy if exists "user_entitlements_admin_write" on public.user_entitlements;
create policy "user_entitlements_admin_write" on public.user_entitlements
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- financial + operational: admin read
drop policy if exists "sub_events_admin_read" on public.subscription_events;
create policy "sub_events_admin_read" on public.subscription_events
  for select to authenticated using (public.is_admin());

drop policy if exists "payment_events_admin_read" on public.payment_events;
create policy "payment_events_admin_read" on public.payment_events
  for select to authenticated using (public.is_admin());

drop policy if exists "sms_admin_read_metadata" on public.sms_messages;
create policy "sms_admin_read_metadata" on public.sms_messages
  for select to authenticated using (public.is_admin());
-- ^ Body column is exposed by this policy. App layer must redact for
--   non-super_admin viewers (or add a redacted view in a later migration).

drop policy if exists "usage_daily_admin_read" on public.usage_daily;
create policy "usage_daily_admin_read" on public.usage_daily
  for select to authenticated using (public.is_admin());

drop policy if exists "usage_monthly_admin_read" on public.usage_monthly;
create policy "usage_monthly_admin_read" on public.usage_monthly
  for select to authenticated using (public.is_admin());

drop policy if exists "ai_usage_admin_read" on public.ai_usage_events;
create policy "ai_usage_admin_read" on public.ai_usage_events
  for select to authenticated using (public.is_admin());

drop policy if exists "wf_exec_admin_read" on public.workflow_executions;
create policy "wf_exec_admin_read" on public.workflow_executions
  for select to authenticated using (public.is_admin());

drop policy if exists "sys_health_admin_read" on public.system_health;
create policy "sys_health_admin_read" on public.system_health
  for select to authenticated using (public.is_admin());

drop policy if exists "alerts_admin_read" on public.system_alerts;
create policy "alerts_admin_read" on public.system_alerts
  for select to authenticated using (public.is_admin());

drop policy if exists "alerts_admin_ack" on public.system_alerts;
create policy "alerts_admin_ack" on public.system_alerts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "deletion_admin_read" on public.data_deletion_requests;
create policy "deletion_admin_read" on public.data_deletion_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "deletion_super_manage" on public.data_deletion_requests;
create policy "deletion_super_manage" on public.data_deletion_requests
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- sms_webhook_events: no policy → service_role only.

-- Extend users RLS: admins can read/update all
drop policy if exists "users_admin_read" on public.users;
create policy "users_admin_read" on public.users
  for select to authenticated using (public.is_admin());

drop policy if exists "users_admin_update" on public.users;
create policy "users_admin_update" on public.users
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- subscriptions: admin read
drop policy if exists "subs_admin_read" on public.subscriptions;
create policy "subs_admin_read" on public.subscriptions
  for select to authenticated using (public.is_admin());

-- conversations & messages: super_admin only (privacy)
drop policy if exists "conversations_super_read" on public.conversations;
create policy "conversations_super_read" on public.conversations
  for select to authenticated using (public.is_super_admin());

drop policy if exists "messages_super_read" on public.messages;
create policy "messages_super_read" on public.messages
  for select to authenticated using (public.is_super_admin());

-- =============================================================
-- SEEDS
-- =============================================================
insert into public.plans (slug, name, is_paid, price_cents, currency, daily_message_limit, features)
values
  ('free', 'FaithOn Free',  false,   0, 'usd',    5,
   '{"description":"Free tier — 5 messages per day","memory":false,"devotionals":false}'::jsonb),
  ('plus', 'FaithOn Plus',  true,  199, 'usd', 100,
   '{"description":"Plus tier — deeper conversations, devotionals, memory","memory":true,"devotionals":true,"fair_use_daily":100}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  is_paid = excluded.is_paid,
  price_cents = excluded.price_cents,
  daily_message_limit = excluded.daily_message_limit,
  features = excluded.features,
  updated_at = now();

-- app_settings defaults. Uses dollar-quoting to avoid apostrophe escaping.
insert into public.app_settings (key, value, description, category) values
  ('trial_days',                     to_jsonb(3),                             'Trial length in days for new users (Plus).',                 'plans'),
  ('free_daily_limit',               to_jsonb(5),                             'Max messages/day for Plan A (Free).',                        'plans'),
  ('plus_fair_use_daily',            to_jsonb(100),                           'Soft-cap for Plan B before rate limiting kicks in.',         'plans'),
  ('grace_period_hours',             to_jsonb(72),                            'Hours a past-due sub keeps Plus access.',                    'plans'),
  ('price_display_usd',              to_jsonb(1.99),                          'Display price on marketing site.',                            'plans'),
  ('currency',                       to_jsonb('usd'::text),                   'Payment currency (ISO 4217).',                                'plans'),
  ('cost_sms_inbound_cents',         to_jsonb(0.79),                          'Estimated Twilio inbound SMS cost per segment (US).',         'costs'),
  ('cost_sms_outbound_cents',        to_jsonb(0.79),                          'Estimated Twilio outbound SMS cost per segment (US).',        'costs'),
  ('cost_openai_gpt4omini_in_per1k', to_jsonb(0.015),                         'gpt-4o-mini input cost per 1k tokens (cents).',               'costs'),
  ('cost_openai_gpt4omini_out_per1k',to_jsonb(0.060),                         'gpt-4o-mini output cost per 1k tokens (cents).',              'costs'),
  ('cost_openai_gpt4o_in_per1k',     to_jsonb(0.250),                         'gpt-4o input cost per 1k tokens (cents).',                    'costs'),
  ('cost_openai_gpt4o_out_per1k',    to_jsonb(1.000),                         'gpt-4o output cost per 1k tokens (cents).',                   'costs'),
  ('stripe_fee_pct',                 to_jsonb(2.9),                           'Stripe percentage fee for margin calc.',                      'costs'),
  ('stripe_fee_fixed_cents',         to_jsonb(30),                            'Stripe fixed fee per transaction (cents).',                   'costs'),
  ('safety_margin_pct',              to_jsonb(20),                            'Buffer % applied on top of cost estimates.',                  'costs'),
  ('conversation_retention_days',    to_jsonb(365),                           'Retention window for full conversation content.',             'privacy'),
  ('maintenance_mode',               to_jsonb(false),                         'When true, SMS handler returns a maintenance message.',       'system'),
  ('openai_model_primary',           to_jsonb('gpt-4o-mini'::text),           'Default OpenAI model.',                                       'ai'),
  ('openai_model_fallback',          to_jsonb('gpt-4o'::text),                'Fallback OpenAI model on error/limit.',                       'ai'),
  ('text_welcome',                   to_jsonb($$Welcome to FaithOn. You have 3 days of Plus, on us. Send PRAY anytime and I'll be here. Reply STOP to opt out, HELP for help.$$::text), 'First-touch welcome message.',           'copy'),
  ('text_limit_free',                to_jsonb($$You've reached today's limit. It resets at midnight. Reply PLUS to unlock unlimited support.$$::text),                                     'Sent when free user hits daily cap.',    'copy'),
  ('text_upgrade_link',              to_jsonb($$Upgrade to FaithOn Plus for $1.99/mo: {url}$$::text),                                                                                     'SMS upgrade link. {url} is replaced.',   'copy'),
  ('text_trial_expired',             to_jsonb($$Your Plus trial has ended. Continue for $1.99/mo: {url} — or stay Free (5 msgs/day).$$::text),                                             'Sent when trial expires.',                'copy'),
  ('text_grace_period',              to_jsonb($$We couldn't process your payment. Update your card within 72h to keep Plus: {url}$$::text),                                                'Sent when subscription enters past_due.', 'copy'),
  ('text_help',                      to_jsonb($$FaithOn: a spiritual companion by SMS. Reply STOP to opt out. Msg&data rates may apply. Support: help@faithon.ai$$::text),                'Response to HELP keyword.',               'copy'),
  ('text_stop_ack',                  to_jsonb($$You've been unsubscribed from FaithOn. Reply START to resubscribe.$$::text),                                                              'Response to STOP keyword.',               'copy'),
  ('text_start_ack',                 to_jsonb($$Welcome back to FaithOn. Send PRAY to begin.$$::text),                                                                                     'Response to START/UNSTOP keyword.',       'copy')
on conflict (key) do nothing;

insert into public.system_health (component, status, details) values
  ('twilio',   'unknown', '{}'::jsonb),
  ('stripe',   'unknown', '{}'::jsonb),
  ('n8n',      'unknown', '{}'::jsonb),
  ('openai',   'unknown', '{}'::jsonb),
  ('database', 'ok',      '{}'::jsonb),
  ('api',      'ok',      '{}'::jsonb),
  ('cron',     'unknown', '{}'::jsonb)
on conflict (component) do nothing;

-- =============================================================
-- Bootstrap: promote a Supabase Auth user to admin
--
-- Usage (run in Supabase SQL editor after the user signs up):
--   select public.promote_to_admin('brucnascimento@gmail.com', 'super_admin');
-- =============================================================
create or replace function public.promote_to_admin(
  p_email citext,
  p_role public.admin_role default 'super_admin'
)
returns public.admin_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.admin_users;
begin
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then
    raise exception 'No auth.users row for %. Sign up first, then re-run.', p_email;
  end if;

  insert into public.admin_users (id, email, role)
  values (v_uid, p_email, p_role)
  on conflict (id) do update
    set role = excluded.role,
        email = excluded.email,
        active = true,
        updated_at = now()
  returning * into v_row;

  insert into public.admin_audit_logs (admin_id, admin_email, action, target_type, target_id, metadata)
  values (v_uid, p_email, 'admin.promote', 'admin_user', v_uid::text,
          jsonb_build_object('role', p_role));

  return v_row;
end;
$$;

comment on function public.promote_to_admin(citext, public.admin_role) is
  'Bootstrap helper. Run once per admin after they sign up.';

-- =============================================================
-- END Phase 1 migration
-- =============================================================

-- =============================================================
-- FaithOn — Message trace / observability
-- Records every stage of message processing with correlation_id.
-- =============================================================

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  message_id uuid references public.sms_messages(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  stage text not null,
  status text not null check (status in ('pending','processing','success','failed','skipped')),
  provider text,
  duration_ms integer,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_events_correlation
  on public.message_events(correlation_id, created_at);
create index if not exists idx_message_events_message
  on public.message_events(message_id, created_at);
create index if not exists idx_message_events_user
  on public.message_events(user_id, created_at desc);
create index if not exists idx_message_events_stage_status
  on public.message_events(stage, status, created_at desc);
create index if not exists idx_message_events_failed
  on public.message_events(created_at desc) where status = 'failed';

alter table public.message_events enable row level security;

-- Admins can read traces
drop policy if exists "message_events_admin_read" on public.message_events;
create policy "message_events_admin_read" on public.message_events
  for select to authenticated using (public.is_admin());

-- Service role writes (no policy needed)

comment on table public.message_events is
  'Structured trace of every message processing stage. Enables "n8n-like" visual debugging in backoffice.';

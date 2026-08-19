-- =============================================================
-- FaithOn — SMSGate support
-- Adds provider_message_id so we can track SMSGate message IDs
-- alongside (or instead of) Twilio MessageSid.
-- =============================================================

-- ---------- Extend sms_messages for generic provider tracking ----------
alter table public.sms_messages
  add column if not exists provider_message_id text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_sms_provider_message_id
  on public.sms_messages(provider, provider_message_id)
  where provider_message_id is not null;

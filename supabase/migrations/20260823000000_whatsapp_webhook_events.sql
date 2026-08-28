-- =============================================================
-- FaithOn — raw Uzapi WhatsApp webhook events table
-- Used to inspect payload shape before building full handler.
-- =============================================================

create table if not exists public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz null
);

-- Useful for ordering by arrival time during debugging.
create index if not exists idx_whatsapp_webhook_events_received_at
  on public.whatsapp_webhook_events (received_at desc);

-- =============================================================
-- FaithOn — system_health heartbeat infrastructure
-- =============================================================

-- Add smsgate to the component enum.
alter type public.system_component add value if not exists 'smsgate';

-- Add smsgate component (replaces the legacy twilio slot in practice,
-- but we keep twilio for backwards compatibility if ever re-enabled).
insert into public.system_health (component, status, details)
values ('smsgate', 'unknown', '{}'::jsonb)
on conflict (component) do nothing;

-- Ensure all expected components exist with sane defaults.
insert into public.system_health (component, status, details) values
  ('database', 'ok',      '{}'::jsonb),
  ('api',      'ok',      '{}'::jsonb)
on conflict (component) do nothing;

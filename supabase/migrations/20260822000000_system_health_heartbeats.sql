-- =============================================================
-- FaithOn — system_health heartbeat infrastructure
-- =============================================================

-- Add smsgate to the component enum.
alter type public.system_component add value if not exists 'smsgate';

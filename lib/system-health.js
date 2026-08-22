// FaithOn — system health heartbeat helper
//
// Call this from any component that wants to report its health to the
// system_health table surfaced in the admin dashboard.

const { supabase } = require('./supabase');

/**
 * Upsert a heartbeat for a system component.
 * @param {string} component  e.g. 'api', 'smsgate', 'stripe', 'openai', 'cron', 'n8n'
 * @param {string} status     'ok' | 'degraded' | 'down' | 'unknown'
 * @param {object} [details]  optional jsonb payload
 */
async function heartbeat(component, status = 'ok', details = {}) {
  const validStatuses = ['ok', 'degraded', 'down', 'unknown'];
  const normalizedStatus = validStatuses.includes(status) ? status : 'unknown';

  const { error } = await supabase.from('system_health').upsert({
    component,
    status: normalizedStatus,
    last_heartbeat_at: new Date().toISOString(),
    details: details ?? {},
  }, { onConflict: 'component' });

  if (error) {
    console.error(`[system-health] failed to write heartbeat for ${component}:`, error.message);
  }
}

module.exports = { heartbeat };

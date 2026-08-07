const express = require('express');
const { supabase } = require('../lib/supabase');

const router = express.Router();

function requireN8nSecret(req, res, next) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'N8N_WEBHOOK_SECRET not configured' });
  }
  const provided = req.headers['x-n8n-secret'];
  if (provided !== secret) return res.status(401).json({ error: 'invalid secret' });
  next();
}

router.post('/n8n/heartbeat', express.json(), requireN8nSecret, async (req, res) => {
  const { details = {} } = req.body || {};
  await supabase.from('system_health').upsert({
    component: 'n8n',
    status: 'ok',
    last_heartbeat_at: new Date().toISOString(),
    details,
  }, { onConflict: 'component' });
  res.status(204).end();
});

router.post('/n8n/execution', express.json(), requireN8nSecret, async (req, res) => {
  const {
    workflow_name,
    execution_id = null,
    status,
    started_at,
    finished_at = null,
    error = null,
    metadata = {},
  } = req.body || {};

  if (!workflow_name || !status || !started_at) {
    return res.status(400).json({ error: 'workflow_name, status, started_at required' });
  }

  const validStatuses = ['running', 'success', 'failed', 'timeout', 'skipped'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${validStatuses.join(',')}` });
  }

  const { data, error: dbErr } = await supabase.from('workflow_executions').upsert({
    workflow_name, execution_id, status,
    started_at, finished_at, error, metadata,
  }, {
    onConflict: execution_id ? 'workflow_name,execution_id' : undefined,
    ignoreDuplicates: false,
  }).select('id').maybeSingle();

  if (dbErr) return res.status(500).json({ error: dbErr.message });

  if (status === 'failed' || status === 'timeout') {
    await supabase.from('system_alerts').insert({
      severity: status === 'timeout' ? 'warning' : 'critical',
      code: 'workflow_failed',
      title: `Workflow ${workflow_name} ${status}`,
      message: error || `Workflow ${workflow_name} reported ${status}.`,
      metadata: { workflow_name, execution_id },
    });
  }

  res.json({ id: data?.id ?? null });
});

module.exports = router;

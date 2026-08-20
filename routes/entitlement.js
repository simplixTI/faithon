const express = require('express');
const { normalizePhoneE164 } = require('../lib/phone');
const { checkEntitlement } = require('../lib/entitlement');

const router = express.Router();

function requireSecret(req, res, next) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'N8N_WEBHOOK_SECRET not configured' });
  if (req.headers['x-n8n-secret'] !== secret) return res.status(401).json({ error: 'invalid secret' });
  next();
}

/**
 * GET /api/entitlement/:phone
 * Called from n8n before generating an AI response.
 * Returns whether the phone is allowed to receive a full response now.
 */
router.get('/entitlement/:phone', requireSecret, async (req, res) => {
  try {
    const phone = normalizePhoneE164(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'invalid phone' });

    const result = await checkEntitlement(phone);
    return res.json(result);
  } catch (err) {
    console.error('entitlement error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

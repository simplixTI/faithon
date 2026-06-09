// =====================================================================
// Vercel serverless entry — re-exports the Express app from ../server.js
// vercel.json rewrites /api/* to this handler so all routes
// (/api/config, /api/health, /api/create-checkout-session,
//  /api/stripe/webhook) hit the same Express app.
//
// bodyParser:false → raw request body reaches express.raw() in
// server.js, which Stripe needs for webhook signature verification.
// =====================================================================
module.exports = require('../server');
module.exports.config = {
  api: { bodyParser: false },
};

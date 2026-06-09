// =====================================================================
// FaithOn — server
//   • Serves the marketing site (index.html)
//   • Creates Stripe Checkout subscription sessions ($0.99/mo)
//   • Receives Stripe webhooks → mirrors subscription state to Supabase
//   • Exposes /api/config (publishable key) and /api/health
// =====================================================================
require('dotenv').config();

const express = require('express');
const path = require('path');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const app = express();
const PORT = Number(process.env.PORT) || 5500;

// ---------- Helpers ----------
function normalizePhoneE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length >= 11 && digits.length <= 15) return '+' + digits;
  return null;
}

async function upsertUserByPhone(phoneE164, stripeCustomerId) {
  const payload = { phone_e164: phoneE164 };
  if (stripeCustomerId) payload.stripe_customer_id = stripeCustomerId;
  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'phone_e164' })
    .select()
    .single();
  if (error) throw new Error(`upsertUserByPhone: ${error.message}`);
  return data;
}

// FaithOn Plus product + $0.99/mo price — created lazily on first need.
let cachedPriceId = null;
async function getFaithOnPlusPriceId() {
  if (cachedPriceId) return cachedPriceId;
  const search = await stripe.products.search({
    query: "active:'true' AND metadata['slug']:'faithon-plus'",
  });
  let product = search.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: 'FaithOn Plus',
      description: 'A deeper, daily rhythm — unlimited spiritual companion via SMS.',
      metadata: { slug: 'faithon-plus' },
    });
  }
  const prices = await stripe.prices.list({
    product: product.id, active: true, type: 'recurring', limit: 100,
  });
  let price = prices.data.find(p =>
    p.unit_amount === 99 && p.currency === 'usd' && p.recurring?.interval === 'month'
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 99,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { slug: 'faithon-plus-monthly' },
    });
  }
  cachedPriceId = price.id;
  return cachedPriceId;
}

// =====================================================================
// Stripe webhook — MUST mount before express.json() to receive raw body
// =====================================================================
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      if (secret) {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } else {
        console.warn('⚠  STRIPE_WEBHOOK_SECRET unset — accepting unsigned event (dev only).');
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const { data: existing } = await supabase
      .from('stripe_webhook_events')
      .select('id, processed_at')
      .eq('id', event.id)
      .maybeSingle();

    if (existing?.processed_at) {
      return res.json({ received: true, idempotent: true });
    }

    await supabase.from('stripe_webhook_events').upsert({
      id: event.id, type: event.type, payload: event,
    });

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const phone = session.metadata?.phone_e164;
          if (phone) await upsertUserByPhone(phone, session.customer);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object;
          const customer = await stripe.customers.retrieve(sub.customer);
          const phone =
            customer.metadata?.phone_e164 || normalizePhoneE164(customer.phone);
          if (!phone) { console.warn('No phone for customer', sub.customer); break; }

          const user = await upsertUserByPhone(phone, sub.customer);

          const item = sub.items?.data?.[0];
          await supabase.from('subscriptions').upsert({
            user_id: user.id,
            stripe_subscription_id: sub.id,
            stripe_price_id: item?.price?.id || '',
            stripe_product_id: item?.price?.product || null,
            status: sub.status,
            current_period_start: sub.current_period_start
              ? new Date(sub.current_period_start * 1000).toISOString() : null,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString() : null,
            cancel_at_period_end: !!sub.cancel_at_period_end,
            canceled_at: sub.canceled_at
              ? new Date(sub.canceled_at * 1000).toISOString() : null,
          }, { onConflict: 'stripe_subscription_id' });

          const isActive = ['active', 'trialing'].includes(sub.status);
          await supabase
            .from('users')
            .update({ tier: isActive ? 'plus' : 'free' })
            .eq('id', user.id);
          break;
        }
      }

      await supabase
        .from('stripe_webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', event.id);

      res.json({ received: true });
    } catch (err) {
      console.error('Webhook handler error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// =====================================================================
// Normal middleware
// =====================================================================
app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/config', (_req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const phoneE164 = normalizePhoneE164(req.body?.phone);
    if (!phoneE164) {
      return res.status(400).json({ error: 'Please enter a valid phone number.' });
    }

    const priceId = await getFaithOnPlusPriceId();

    let customer;
    const found = await stripe.customers.search({
      query: `metadata['phone_e164']:'${phoneE164}'`,
    });
    if (found.data.length) {
      customer = found.data[0];
    } else {
      customer = await stripe.customers.create({
        phone: phoneE164,
        metadata: { phone_e164: phoneE164 },
      });
    }

    await upsertUserByPhone(phoneE164, customer.id);

    const origin = req.headers.origin || `http://localhost:${PORT}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { phone_e164: phoneE164 },
      subscription_data: { metadata: { phone_e164: phoneE164 } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', async (_req, res) => {
  let supaOk = false, supaErr = null;
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    supaOk = !error;
    supaErr = error?.message || null;
  } catch (e) { supaErr = e.message; }
  res.json({
    server: 'ok',
    supabase: supaOk ? 'connected' : 'error',
    supabase_detail: supaErr,
    stripe: !!process.env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
    webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'unset (dev)',
  });
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Only start an HTTP listener when run directly (local dev).
// When imported as a Vercel serverless function, the runtime calls
// the exported app(req,res) on each request — no listen() needed.
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log('━'.repeat(60));
    console.log(`✦ FaithOn server  http://localhost:${PORT}`);
    console.log('━'.repeat(60));
    try {
      const priceId = await getFaithOnPlusPriceId();
      console.log(`  Stripe Plus price ready: ${priceId}`);
    } catch (e) {
      console.error(`  ⚠ Stripe price init failed: ${e.message}`);
    }
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      if (error) {
        console.warn(`  ⚠ Supabase: ${error.message}`);
        console.warn(`    → Apply supabase/migrations/20260609000000_initial_schema.sql`);
        console.warn(`    → in Supabase Dashboard → SQL Editor`);
      } else {
        console.log(`  Supabase connected.`);
      }
    } catch (e) {
      console.warn(`  ⚠ Supabase: ${e.message}`);
    }
    console.log('━'.repeat(60));
  });
}

module.exports = app;

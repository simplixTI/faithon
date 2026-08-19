const express = require('express');
const Stripe = require('stripe');
const { normalizePhoneE164 } = require('../lib/phone');
const { upsertUserByPhone } = require('../lib/users');
const { supabase } = require('../lib/supabase');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

/**
 * Resolves the Stripe price ID for the given plan.
 *   plan='monthly' → STRIPE_PLUS_PRICE_ID
 *   plan='yearly'  → STRIPE_PLUS_PRICE_ID_YEARLY
 * Falls back to lazy product/price creation only if the monthly env var
 * is missing — safety net for local dev, dangerous in live.
 */
async function getPlusPriceId(plan = 'monthly') {
  if (plan === 'yearly') {
    if (process.env.STRIPE_PLUS_PRICE_ID_YEARLY) return process.env.STRIPE_PLUS_PRICE_ID_YEARLY;
    throw new Error('STRIPE_PLUS_PRICE_ID_YEARLY is not set — cannot process yearly checkout.');
  }
  if (process.env.STRIPE_PLUS_PRICE_ID) return process.env.STRIPE_PLUS_PRICE_ID;

  // Monthly fallback: lazy-create — cached in memory per warm instance.
  if (getPlusPriceId._cache) return getPlusPriceId._cache;
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
    p.unit_amount === 199 && p.currency === 'usd' && p.recurring?.interval === 'month'
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 199,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { slug: 'faithon-plus-monthly' },
    });
  }
  getPlusPriceId._cache = price.id;
  return price.id;
}

router.post('/create-checkout-session', async (req, res) => {
  try {
    const phoneE164 = normalizePhoneE164(req.body?.phone);
    if (!phoneE164) return res.status(400).json({ error: 'Please enter a valid phone number.' });

    const rawPlan = String(req.body?.plan ?? 'monthly').toLowerCase();
    const plan = rawPlan === 'yearly' ? 'yearly' : 'monthly';
    const priceId = await getPlusPriceId(plan);

    let customer;
    const found = await stripe.customers.search({
      query: `metadata['phone_e164']:'${phoneE164}'`,
    });
    if (found.data.length) customer = found.data[0];
    else customer = await stripe.customers.create({
      phone: phoneE164, metadata: { phone_e164: phoneE164 },
    });

    const user = await upsertUserByPhone(phoneE164, customer.id);

    const origin = req.headers.origin || (process.env.APP_URL ?? `http://localhost:${process.env.PORT || 5500}`);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { phone_e164: phoneE164, faithon_user_id: user.id, source: 'sms', plan },
      subscription_data: { metadata: { phone_e164: phoneE164, faithon_user_id: user.id, plan } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/stripe/portal', async (req, res) => {
  try {
    const phoneE164 = normalizePhoneE164(req.body?.phone);
    if (!phoneE164) return res.status(400).json({ error: 'phone required' });

    const { data: user } = await supabase
      .from('users').select('stripe_customer_id').eq('phone_e164', phoneE164).maybeSingle();
    if (!user?.stripe_customer_id) return res.status(404).json({ error: 'no customer' });

    const origin = req.headers.origin || (process.env.APP_URL ?? `http://localhost:${process.env.PORT || 5500}`);
    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${origin}/`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error('portal error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function createCheckoutSessionForPhone(phoneE164, plan = 'monthly') {
  const priceId = await getPlusPriceId(plan);

  let customer;
  const found = await stripe.customers.search({
    query: `metadata['phone_e164']:'${phoneE164}'`,
  });
  if (found.data.length) customer = found.data[0];
  else customer = await stripe.customers.create({
    phone: phoneE164, metadata: { phone_e164: phoneE164 },
  });

  const user = await upsertUserByPhone(phoneE164, customer.id);

  const origin = process.env.APP_URL ?? 'https://www.faithon.ai';
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancel`,
    allow_promotion_codes: true,
    metadata: { phone_e164: phoneE164, faithon_user_id: user.id, source: 'sms', plan },
    subscription_data: { metadata: { phone_e164: phoneE164, faithon_user_id: user.id, plan } },
  });

  return { url: session.url, id: session.id };
}

module.exports = router;
module.exports.getPlusPriceId = getPlusPriceId;
module.exports.createCheckoutSessionForPhone = createCheckoutSessionForPhone;

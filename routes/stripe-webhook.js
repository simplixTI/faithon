const express = require('express');
const Stripe = require('stripe');
const { supabase } = require('../lib/supabase');
const { upsertUserByPhone } = require('../lib/users');
const { normalizePhoneE164 } = require('../lib/phone');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

async function findUserForCustomer(stripeCustomerId) {
  const { data } = await supabase
    .from('users').select('id, phone_e164').eq('stripe_customer_id', stripeCustomerId).maybeSingle();
  if (data) return data;
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  const phone =
    customer.metadata?.phone_e164 || normalizePhoneE164(customer.phone);
  if (!phone) return null;
  const user = await upsertUserByPhone(phone, stripeCustomerId);
  return user;
}

async function recordSubscriptionState(sub) {
  const user = await findUserForCustomer(sub.customer);
  if (!user) return null;

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

  // Update user's denormalized tier + access_status
  const nextTier = ['active', 'trialing'].includes(sub.status) ? 'plus' : 'free';
  const nextAccess =
    sub.status === 'active'                             ? 'active' :
    sub.status === 'trialing'                            ? 'trial' :
    sub.status === 'past_due'                            ? 'past_due' :
    sub.status === 'unpaid'                              ? 'grace_period' :
    ['canceled','incomplete_expired','paused'].includes(sub.status) ? 'free' :
    'free';

  await supabase.from('users').update({
    tier: nextTier,
    access_status: nextAccess,
  }).eq('id', user.id);

  await supabase.from('user_entitlements').upsert({
    user_id: user.id,
    plan_slug: nextTier,
    access_status: nextAccess,
  }, { onConflict: 'user_id' });

  return user;
}

router.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      if (secret) event = stripe.webhooks.constructEvent(req.body, sig, secret);
      else {
        console.warn('⚠  STRIPE_WEBHOOK_SECRET unset — accepting unsigned event (dev only).');
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotency check.
    const { data: existing } = await supabase
      .from('stripe_webhook_events').select('id, processed_at').eq('id', event.id).maybeSingle();
    if (existing?.processed_at) return res.json({ received: true, idempotent: true });

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
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed': {
          const sub = event.data.object;
          const user = await recordSubscriptionState(sub);
          if (user) {
            await supabase.from('subscription_events').insert({
              stripe_subscription_id: sub.id,
              user_id: user.id,
              event_type: event.type,
              to_status: sub.status,
              stripe_event_id: event.id,
              metadata: { cancel_at_period_end: sub.cancel_at_period_end },
            });
          }
          break;
        }

        case 'invoice.paid':
        case 'invoice.payment_failed': {
          const inv = event.data.object;
          const user = await findUserForCustomer(inv.customer);
          const { data: sub } = user
            ? await supabase.from('subscriptions').select('id').eq('stripe_subscription_id', inv.subscription).maybeSingle()
            : { data: null };
          await supabase.from('payment_events').insert({
            user_id: user?.id ?? null,
            subscription_id: sub?.id ?? null,
            stripe_invoice_id: inv.id,
            stripe_charge_id: inv.charge ?? null,
            stripe_payment_intent_id: inv.payment_intent ?? null,
            amount_cents: inv.amount_paid ?? inv.amount_due ?? null,
            currency: inv.currency,
            status: event.type === 'invoice.paid' ? 'succeeded' : 'failed',
            failure_code: inv.last_payment_error?.code ?? null,
            failure_message: inv.last_payment_error?.message ?? null,
            billing_reason: inv.billing_reason ?? null,
            attempt_count: inv.attempt_count ?? null,
            stripe_event_id: event.id,
          });

          // Grace period on failed payment
          if (event.type === 'invoice.payment_failed' && user) {
            const graceHoursRow = await supabase.from('app_settings').select('value').eq('key', 'grace_period_hours').maybeSingle();
            const graceHours = Number(graceHoursRow.data?.value ?? 72);
            const ends = new Date(Date.now() + graceHours * 3600 * 1000).toISOString();
            await supabase.from('users').update({
              access_status: 'grace_period',
              grace_period_ends_at: ends,
            }).eq('id', user.id);
            await supabase.from('user_entitlements').update({
              access_status: 'grace_period',
              grace_period_ends_at: ends,
            }).eq('user_id', user.id);

            await supabase.from('system_alerts').insert({
              severity: 'warning',
              code: 'invoice_payment_failed',
              title: 'Invoice payment failed',
              message: `User ${user.phone_e164 ?? user.id} entered grace period until ${ends}.`,
              metadata: { user_id: user.id, invoice_id: inv.id },
            });
          }
          break;
        }
      }

      await supabase.from('stripe_webhook_events')
        .update({ processed_at: new Date().toISOString() }).eq('id', event.id);
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook handler error:', err);
      await supabase.from('stripe_webhook_events')
        .update({ error: err.message }).eq('id', event.id).catch(() => {});
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;

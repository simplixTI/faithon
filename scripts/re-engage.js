#!/usr/bin/env node
// =====================================================================
// FaithOn — Re-engagement SMS sender
//
// Sends a one-off SMS to a list of phone numbers. Use case: users who
// previously texted PRAY but dropped off because the gateway was offline.
//
// Usage:
//   node scripts/re-engage.js +18165894867 +13104389963 \
//     -m "FaithOn is back online. Send PRAY to continue. Reply STOP to opt out."
//
//   cat numbers.txt | node scripts/re-engage.js -m "..."
//
// Safety:
//   - Skips opted-out users unless --force is passed.
//   - Skips numbers not in the DB unless --force is passed.
//   - Use --dry-run to preview without sending.
// =====================================================================
require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { getSmsProvider, estimateSegments } = require('../lib/sms-provider');
const { computeSmsCostCents } = require('../lib/cost');
const { normalizePhoneE164 } = require('../lib/phone');

const DEFAULT_MESSAGE =
  "FaithOn is back online. Send PRAY to continue your conversation. Reply STOP to opt out.";

function parseArgs(argv) {
  const numbers = [];
  let message = null;
  let force = false;
  let dryRun = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-m' || arg === '--message') {
      message = argv[++i];
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('-')) {
      numbers.push(arg);
    }
  }

  return { numbers, message: message || DEFAULT_MESSAGE, force, dryRun };
}

async function readStdinNumbers() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      const text = chunks.join('');
      const list = text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(list);
    });
    // If stdin is a TTY, resolve immediately so we don't hang.
    if (process.stdin.isTTY) resolve([]);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const stdinNumbers = await readStdinNumbers();
  const rawNumbers = [...args.numbers, ...stdinNumbers];

  if (rawNumbers.length === 0) {
    console.error(`Usage: node scripts/re-engage.js [options] <phone> [<phone> ...]

Options:
  -m, --message <text>   Custom message (default provided)
      --force            Send even if number is not in DB or opted out
      --dry-run          Preview without sending

Examples:
  node scripts/re-engage.js +18165894867 +13104389963
  node scripts/re-engage.js +18165894867 -m "Welcome back to FaithOn!"
  cat numbers.txt | node scripts/re-engage.js --dry-run`);
    process.exit(1);
  }

  // Normalize and dedupe.
  const seen = new Set();
  const targetNumbers = [];
  for (const raw of rawNumbers) {
    const normalized = normalizePhoneE164(raw);
    if (!normalized) {
      console.warn(`⚠ Invalid phone, skipping: ${raw}`);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    targetNumbers.push(normalized);
  }

  console.log(`Target numbers: ${targetNumbers.length}`);
  console.log(`Message (${estimateSegments(args.message)} segment(s)): ${args.message}`);
  if (args.dryRun) console.log('--- DRY RUN ---');

  // Fetch existing users + consents for these numbers.
  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('id, phone_e164, first_name, access_status, user_consents(opt_out, opt_out_at)')
    .in('phone_e164', targetNumbers)
    .is('deleted_at', null);

  if (userErr) {
    console.error('Failed to fetch users:', userErr.message);
    process.exit(1);
  }

  const userByPhone = new Map();
  for (const u of users ?? []) userByPhone.set(u.phone_e164, u);

  const sms = getSmsProvider();
  const segments = estimateSegments(args.message);
  const priceCents = await computeSmsCostCents({ segments, direction: 'outbound' });

  const results = { sent: 0, failed: 0, skipped: 0, dryRun: args.dryRun };

  for (const phone of targetNumbers) {
    const user = userByPhone.get(phone);
    const consent = user?.user_consents?.[0];

    if (!user && !args.force) {
      console.log(`⏭ ${phone}: not in DB (use --force to send anyway)`);
      results.skipped++;
      continue;
    }

    if (user?.access_status === 'opted_out' || consent?.opt_out) {
      if (!args.force) {
        console.log(`⏭ ${phone}: opted out (use --force to override)`);
        results.skipped++;
        continue;
      }
      console.log(`⚠ ${phone}: opted out but --force was used`);
    }

    if (args.dryRun) {
      console.log(`✉️  ${phone}: would send`);
      continue;
    }

    try {
      const result = await sms.send({ to: phone, text: args.message });
      await supabase.from('sms_messages').insert({
        user_id: user?.id ?? null,
        direction: 'outbound',
        to_e164: phone,
        body: args.message,
        provider: process.env.SMS_PROVIDER || 'smsgate',
        provider_message_id: result.providerMessageId ?? null,
        provider_metadata: result.raw ?? {},
        num_segments: segments,
        status: 'queued',
        command: 'reengage',
        price_cents: priceCents,
      });
      console.log(`✅ ${phone}: sent (id=${result.providerMessageId ?? 'n/a'})`);
      results.sent++;
    } catch (err) {
      console.error(`❌ ${phone}: ${err.message}`);
      results.failed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Sent:    ${results.sent}`);
  console.log(`Failed:  ${results.failed}`);
  console.log(`Skipped: ${results.skipped}`);
  if (results.dryRun) console.log('(dry run — nothing was actually sent)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

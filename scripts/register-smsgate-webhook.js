// Registra webhooks no Android SMS Gateway para receber eventos no FaithOn backend.
//
// Uso:
//   node scripts/register-smsgate-webhook.js
//
// ENV necessárias:
//   SMSGATE_URL=http://192.168.15.2:8080
//   SMSGATE_USER=sms
//   SMSGATE_PASS=Gab@2020
//   APP_URL=https://www.faithon.ai   (ou http://... para testes locais)

require('dotenv').config();
const { registerWebhook, listWebhooks } = require('../lib/smsgate');

const APP_URL = (process.env.APP_URL || 'http://localhost:5500').replace(/\/$/, '');
const EVENTS = ['sms:received', 'mms:received', 'sms:sent', 'sms:delivered', 'sms:failed'];

async function main() {
  console.log('URL do FaithOn backend:', APP_URL);
  console.log('');

  console.log('Webhooks já registrados:');
  const existing = await listWebhooks();
  console.log(JSON.stringify(existing.body, null, 2));
  console.log('');

  for (const event of EVENTS) {
    const url = `${APP_URL}/api/sms/${event === 'sms:received' ? 'incoming' : 'status'}`;
    console.log(`Registrando webhook: ${event} → ${url}`);
    const result = await registerWebhook({ url, event });
    console.log(`Status: ${result.status}`);
    console.log('Resposta:', JSON.stringify(result.body, null, 2));
    console.log('');
  }

  console.log('✅ Registro concluído.');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});

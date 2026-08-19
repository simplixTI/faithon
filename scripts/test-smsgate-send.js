// Testa o envio de SMS pelo SMSGate local (Android via USB/ADB).
//
// Uso:
//   node scripts/test-smsgate-send.js
//   node scripts/test-smsgate-send.js +5521999999999 "Mensagem personalizada"
//
// Configuração vem do .env ou dos argumentos:
//   SMSGATE_URL=http://192.168.15.2:8080/message
//   SMSGATE_USER=sms
//   SMSGATE_PASS=Gab@2020
//   SMSGATE_TO=+5521951014062
//   SMSGATE_TEXT=Teste FaithOn 🙏

require('dotenv').config();
const http = require('http');

const SMSGATE_BASE_URL = (process.env.SMSGATE_URL || 'http://192.168.15.2:8080').replace(/\/$/, '');
const SMSGATE_URL = SMSGATE_BASE_URL.endsWith('/message') ? SMSGATE_BASE_URL : `${SMSGATE_BASE_URL}/message`;
const SMSGATE_USER = process.env.SMSGATE_USER || 'sms';
const SMSGATE_PASS = process.env.SMSGATE_PASS || 'Gab@2020';
const TO = process.argv[2] || process.env.SMSGATE_TO || '+5521951014062';
const TEXT = process.argv[3] || process.env.SMSGATE_TEXT || 'Teste FaithOn 🙏';

const parsed = new URL(SMSGATE_URL);
const payload = JSON.stringify({
  textMessage: { text: TEXT },
  phoneNumbers: [TO],
});

const auth = Buffer.from(`${SMSGATE_USER}:${SMSGATE_PASS}`).toString('base64');

const options = {
  hostname: parsed.hostname,
  port: parsed.port || 8080,
  path: parsed.path || '/message',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    Authorization: `Basic ${auth}`,
  },
};

console.log('Enviando SMS via SMSGate...');
console.log('URL:', SMSGATE_URL);
console.log('Para:', TO);
console.log('Texto:', TEXT);
console.log('');

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Resposta:', data);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('✅ SMS enviado com sucesso (verifique o aparelho).');
    } else {
      console.error('❌ Falha no envio.');
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Erro na requisição:', err.message);
  console.error('Verifique se o celular está conectado, o SMSGate aberto e a URL/IP corretos.');
  process.exit(1);
});

req.write(payload);
req.end();

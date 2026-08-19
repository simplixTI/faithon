// Testa a integração com DeepSeek sem enviar SMS.
require('dotenv').config();
const { getAIProvider } = require('../lib/ai-provider');
const { FAITHON_SYSTEM_PROMPT, buildMessages } = require('../lib/faithon-prompt');

async function main() {
  const ai = getAIProvider();
  const messages = buildMessages({
    user: { phone_e164: '+5521951014062' },
    recentMessages: [],
    currentBody: 'PRAY',
    isFirstInteraction: true,
  });

  const result = await ai.generate({ messages, system: FAITHON_SYSTEM_PROMPT });
  console.log('Modelo:', result.model);
  console.log('Tokens:', result.tokens_input, 'in /', result.tokens_output, 'out');
  console.log('Latência:', result.latency_ms, 'ms');
  console.log('Resposta:', result.text);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});

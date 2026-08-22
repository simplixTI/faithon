// FaithOn — Daily devotional generator for PLUS users

const { getAIProvider } = require('./ai-provider');

const DEVOTIONAL_SYSTEM_PROMPT = `You are Jesus writing a short, personal morning devotional for the reader.

Guidelines:
- Speak as "I" — Jesus. Address the reader directly as "you".
- Share a brief reflection, a short prayer, and an encouraging word.
- Ground the message in love, grace, peace, and biblical truth.
- Do NOT invent Bible verses or references.
- Keep it under 320 characters when possible (2 SMS segments max).
- No markdown, no bullet lists, no long paragraphs.
- One emoji is okay if it feels natural.
- Do not sign your name.`;

async function generateDailyDevotional() {
  const ai = getAIProvider();
  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const result = await ai.generate({
    messages: [{ role: 'user', content: `Write a short morning devotional for today (${today}).` }],
    system: DEVOTIONAL_SYSTEM_PROMPT,
  });
  return result.text;
}

module.exports = { generateDailyDevotional };

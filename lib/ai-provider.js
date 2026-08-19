// FaithOn — AI Provider abstraction
//
// Supported providers:
//   AI_PROVIDER=deepseek   -> DeepSeek API (OpenAI-compatible)
//   AI_PROVIDER=openai     -> OpenAI
//
// Future: anthropic, google, local, etc.

const OpenAI = require('openai');

class AIProvider {
  /**
   * Generate a chat completion.
   * @param {Object} opts
   * @param {Array<{role: string, content: string}>} opts.messages
   * @param {string} [opts.system]
   * @returns {Promise<{text: string, model: string, tokens_input: number, tokens_output: number, latency_ms: number, raw: object}>}
   */
  async generate({ messages, system }) {
    throw new Error('AIProvider.generate() not implemented');
  }
}

class DeepSeekProvider extends AIProvider {
  constructor() {
    super();
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      timeout: Number(process.env.AI_TIMEOUT_MS || 15000),
      maxRetries: 2,
    });
    this.model = process.env.AI_MODEL || 'deepseek-chat';
  }

  async generate({ messages, system }) {
    const startedAt = Date.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: Number(process.env.AI_MAX_TOKENS || 160),
      temperature: Number(process.env.AI_TEMPERATURE || 0.7),
    });
    const latencyMs = Date.now() - startedAt;

    const choice = completion.choices?.[0];
    const text = choice?.message?.content?.trim() || '';

    return {
      text,
      model: completion.model || this.model,
      tokens_input: completion.usage?.prompt_tokens || 0,
      tokens_output: completion.usage?.completion_tokens || 0,
      latency_ms: latencyMs,
      raw: completion,
    };
  }
}

class OpenAIProvider extends AIProvider {
  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    this.client = new OpenAI({
      apiKey,
      timeout: Number(process.env.AI_TIMEOUT_MS || 15000),
      maxRetries: 2,
    });
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  async generate({ messages, system }) {
    const startedAt = Date.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: Number(process.env.AI_MAX_TOKENS || 160),
      temperature: Number(process.env.AI_TEMPERATURE || 0.7),
    });
    const latencyMs = Date.now() - startedAt;

    const choice = completion.choices?.[0];
    const text = choice?.message?.content?.trim() || '';

    return {
      text,
      model: completion.model || this.model,
      tokens_input: completion.usage?.prompt_tokens || 0,
      tokens_output: completion.usage?.completion_tokens || 0,
      latency_ms: latencyMs,
      raw: completion,
    };
  }
}

function getAIProvider() {
  const name = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
  if (name === 'deepseek') return new DeepSeekProvider();
  if (name === 'openai') return new OpenAIProvider();
  throw new Error(`Unsupported AI_PROVIDER: ${name}`);
}

module.exports = {
  AIProvider,
  DeepSeekProvider,
  OpenAIProvider,
  getAIProvider,
};

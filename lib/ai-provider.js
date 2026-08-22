// FaithOn — AI Provider abstraction
//
// Supported providers:
//   AI_PROVIDER=deepseek   -> DeepSeek API (OpenAI-compatible)
//   AI_PROVIDER=openai     -> OpenAI
//   AI_PROVIDER=openrouter -> OpenRouter with model fallback
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

function buildMessages(system, messages) {
  return system ? [{ role: 'system', content: system }, ...messages] : messages;
}

function parseCompletion(completion, requestedModel, latencyMs) {
  const choice = completion.choices?.[0];
  const text = choice?.message?.content?.trim() || '';
  return {
    text,
    model: completion.model || requestedModel,
    tokens_input: completion.usage?.prompt_tokens || 0,
    tokens_output: completion.usage?.completion_tokens || 0,
    latency_ms: latencyMs,
    raw: completion,
  };
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
      messages: buildMessages(system, messages),
      max_tokens: Number(process.env.AI_MAX_TOKENS || 160),
      temperature: Number(process.env.AI_TEMPERATURE || 0.85),
    });
    return parseCompletion(completion, this.model, Date.now() - startedAt);
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
      messages: buildMessages(system, messages),
      max_tokens: Number(process.env.AI_MAX_TOKENS || 160),
      temperature: Number(process.env.AI_TEMPERATURE || 0.85),
    });
    return parseCompletion(completion, this.model, Date.now() - startedAt);
  }
}

class OpenRouterProvider extends AIProvider {
  constructor() {
    super();
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

    const modelsString = process.env.OPENROUTER_MODELS || 'deepseek/deepseek-chat,openai/gpt-4o-mini';
    this.models = modelsString.split(',').map((m) => m.trim()).filter(Boolean);
    if (this.models.length === 0) throw new Error('OPENROUTER_MODELS is empty');

    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: Number(process.env.AI_TIMEOUT_MS || 20000),
      maxRetries: 1,
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'https://www.faithon.ai',
        'X-Title': 'FaithOn',
      },
    });
  }

  async generate({ messages, system }) {
    const startedAt = Date.now();
    const lastError = null;

    for (const model of this.models) {
      try {
        const completion = await this.client.chat.completions.create({
          model,
          messages: buildMessages(system, messages),
          max_tokens: Number(process.env.AI_MAX_TOKENS || 160),
          temperature: Number(process.env.AI_TEMPERATURE || 0.85),
        });
        return parseCompletion(completion, model, Date.now() - startedAt);
      } catch (err) {
        console.warn(`OpenRouter model ${model} failed:`, err.message);
        lastError = err;
      }
    }

    throw lastError || new Error('All OpenRouter models failed');
  }
}

function getAIProvider() {
  const name = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
  if (name === 'deepseek') return new DeepSeekProvider();
  if (name === 'openai') return new OpenAIProvider();
  if (name === 'openrouter') return new OpenRouterProvider();
  throw new Error(`Unsupported AI_PROVIDER: ${name}`);
}

module.exports = {
  AIProvider,
  DeepSeekProvider,
  OpenAIProvider,
  OpenRouterProvider,
  getAIProvider,
};

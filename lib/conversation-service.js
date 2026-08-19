// FaithOn — Conversation + AI reply service
//
// Responsibilities:
//   - find or create the user's active conversation
//   - fetch recent messages for context
//   - call the configured AI provider
//   - persist assistant response in messages + sms_messages
//   - record AI usage

const { supabase } = require('./supabase');
const { getAIProvider } = require('./ai-provider');
const { getSmsProvider, estimateSegments } = require('./sms-provider');
const { FAITHON_SYSTEM_PROMPT, buildMessages } = require('./faithon-prompt');
const { computeSmsCostCents, computeOpenAICostCents } = require('./cost');
const { searchBibleVerses, formatBibleContext } = require('./bible-rag');
const { STAGES, STATUS, record, startStage, completeStage } = require('./trace');

async function getOrCreateConversation(userId) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('archived', false)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error) throw new Error(`create conversation: ${error.message}`);
  return created.id;
}

async function getRecentMessages(conversationId, limit = 6) {
  const { data } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function generateReply({ user, body, isFirstInteraction, correlationId = null, messageId = null }) {
  const conversationId = await getOrCreateConversation(user.id);
  const recentMessages = await getRecentMessages(conversationId);

  await record({ correlationId, stage: STAGES.CONVERSATION_LOADED, status: STATUS.SUCCESS, userId: user.id, conversationId });

  // Bible RAG: find relevant verses for the user's message
  let bibleContext = null;
  try {
    const ragStage = await startStage({ correlationId, stage: STAGES.BIBLE_RAG_STARTED, provider: 'openai', userId: user.id });
    const verses = await searchBibleVerses(body, 5);
    bibleContext = formatBibleContext(verses);
    await completeStage(ragStage, { status: STATUS.SUCCESS, metadata: { versesFound: verses.length } });
  } catch (err) {
    console.warn('Bible RAG failed:', err.message);
    await record({ correlationId, stage: STAGES.BIBLE_RAG_FAILED, status: STATUS.FAILED, userId: user.id, errorMessage: err.message });
  }

  const systemPrompt = bibleContext
    ? `${FAITHON_SYSTEM_PROMPT}\n\nRelevant Bible verses to draw from (quote only if natural and accurate):\n${bibleContext}`
    : FAITHON_SYSTEM_PROMPT;

  const ai = getAIProvider();
  const messages = buildMessages({
    user,
    recentMessages,
    currentBody: body,
    isFirstInteraction,
  });

  const aiStage = await startStage({ correlationId, stage: STAGES.AI_REQUEST_STARTED, provider: process.env.AI_PROVIDER || 'deepseek', userId: user.id });
  const result = await ai.generate({ messages, system: systemPrompt });
  const text = result.text;
  await completeStage(aiStage, { status: STATUS.SUCCESS, metadata: { model: result.model, tokens: { input: result.tokens_input, output: result.tokens_output } } });

  // Persist assistant message in conversations/messages
  const { data: assistantMessage } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: 'companion',
    content: text,
    tokens_used: result.tokens_output,
  }).select('id').single();

  // Record AI usage
  const aiCost = await computeOpenAICostCents({
    model: result.model,
    tokensInput: result.tokens_input,
    tokensOutput: result.tokens_output,
  });
  await supabase.from('ai_usage_events').insert({
    user_id: user.id,
    conversation_id: conversationId,
    message_id: assistantMessage?.id ?? null,
    provider: process.env.AI_PROVIDER || 'deepseek',
    model: result.model,
    tokens_input: result.tokens_input,
    tokens_output: result.tokens_output,
    latency_ms: result.latency_ms,
    estimated_cost_cents: aiCost,
  });

  // Send SMS
  const smsStage = await startStage({ correlationId, stage: STAGES.SMS_SEND_STARTED, provider: process.env.SMS_PROVIDER || 'smsgate', userId: user.id });
  const sms = getSmsProvider();
  const smsResult = await sms.send({ to: user.phone_e164, text });
  const segments = estimateSegments(text);
  const smsCost = await computeSmsCostCents({ segments, direction: 'outbound' });
  await completeStage(smsStage, { status: STATUS.SUCCESS, metadata: { providerMessageId: smsResult.providerMessageId } });

  await supabase.from('sms_messages').insert({
    user_id: user.id,
    conversation_id: conversationId,
    direction: 'outbound',
    from_e164: null,
    to_e164: user.phone_e164,
    body: text,
    provider: process.env.SMS_PROVIDER || 'smsgate',
    provider_message_id: smsResult.providerMessageId,
    provider_metadata: smsResult.raw,
    num_segments: segments,
    status: 'queued',
    command: null,
    price_cents: smsCost,
  });

  // Update conversation + user activity
  await supabase.from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  await supabase.from('users').update({
    last_active_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  }).eq('id', user.id);

  // Roll up usage_daily (outbound + AI)
  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRow } = await supabase
    .from('usage_daily')
    .select('*')
    .eq('user_id', user.id).eq('usage_date', today).maybeSingle();
  await supabase.from('usage_daily').upsert({
    user_id: user.id,
    usage_date: today,
    message_count: (usageRow?.message_count ?? 0) + 1,
    outbound_count: (usageRow?.outbound_count ?? 0) + 1,
    ai_tokens_input: (usageRow?.ai_tokens_input ?? 0) + result.tokens_input,
    ai_tokens_output: (usageRow?.ai_tokens_output ?? 0) + result.tokens_output,
    estimated_cost_cents: Number(usageRow?.estimated_cost_cents ?? 0) + aiCost + smsCost,
  }, { onConflict: 'user_id,usage_date' });

  return {
    text,
    conversationId,
    messageId: assistantMessage?.id,
    tokens: {
      input: result.tokens_input,
      output: result.tokens_output,
    },
    costs: {
      ai: aiCost,
      sms: smsCost,
    },
  };
}

module.exports = { generateReply };

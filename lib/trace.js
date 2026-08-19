// FaithOn — Message trace / observability
// Records every stage of message processing with correlation_id.

const { supabase } = require('./supabase');

const STAGES = {
  SMS_RECEIVED: 'SMS_RECEIVED',
  WEBHOOK_VALIDATED: 'WEBHOOK_VALIDATED',
  PHONE_NORMALIZED: 'PHONE_NORMALIZED',
  USER_LOOKUP_STARTED: 'USER_LOOKUP_STARTED',
  USER_FOUND: 'USER_FOUND',
  USER_CREATED: 'USER_CREATED',
  ENTITLEMENT_CHECK_STARTED: 'ENTITLEMENT_CHECK_STARTED',
  ENTITLEMENT_ALLOWED: 'ENTITLEMENT_ALLOWED',
  ENTITLEMENT_BLOCKED: 'ENTITLEMENT_BLOCKED',
  CONVERSATION_LOADED: 'CONVERSATION_LOADED',
  BIBLE_RAG_STARTED: 'BIBLE_RAG_STARTED',
  BIBLE_RAG_COMPLETED: 'BIBLE_RAG_COMPLETED',
  BIBLE_RAG_FAILED: 'BIBLE_RAG_FAILED',
  AI_REQUEST_STARTED: 'AI_REQUEST_STARTED',
  AI_REQUEST_COMPLETED: 'AI_REQUEST_COMPLETED',
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED',
  SMS_SEND_STARTED: 'SMS_SEND_STARTED',
  SMS_SEND_COMPLETED: 'SMS_SEND_COMPLETED',
  SMS_SEND_FAILED: 'SMS_SEND_FAILED',
  DELIVERY_CONFIRMED: 'DELIVERY_CONFIRMED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  FLOW_COMPLETED: 'FLOW_COMPLETED',
  FLOW_FAILED: 'FLOW_FAILED',
};

const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

async function record({
  correlationId,
  messageId = null,
  conversationId = null,
  userId = null,
  stage,
  status,
  provider = null,
  durationMs = null,
  errorCode = null,
  errorMessage = null,
  metadata = {},
}) {
  try {
    await supabase.from('message_events').insert({
      correlation_id: correlationId,
      message_id: messageId,
      conversation_id: conversationId,
      user_id: userId,
      stage,
      status,
      provider,
      duration_ms: durationMs,
      error_code: errorCode,
      error_message: errorMessage,
      metadata,
    });
  } catch (err) {
    console.error('trace record failed:', err.message);
  }
}

async function startStage({
  correlationId,
  messageId = null,
  conversationId = null,
  userId = null,
  stage,
  provider = null,
  metadata = {},
}) {
  const startedAt = Date.now();
  await record({
    correlationId,
    messageId,
    conversationId,
    userId,
    stage,
    status: STATUS.PROCESSING,
    provider,
    metadata,
  });
  return {
    correlationId,
    messageId,
    conversationId,
    userId,
    stage,
    provider,
    startedAt,
  };
}

async function completeStage(ctx, { status = STATUS.SUCCESS, errorCode = null, errorMessage = null, metadata = {} } = {}) {
  const durationMs = Date.now() - ctx.startedAt;
  await record({
    correlationId: ctx.correlationId,
    messageId: ctx.messageId,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    stage: ctx.stage,
    status,
    provider: ctx.provider,
    durationMs,
    errorCode,
    errorMessage,
    metadata,
  });
}

module.exports = {
  STAGES,
  STATUS,
  record,
  startStage,
  completeStage,
};

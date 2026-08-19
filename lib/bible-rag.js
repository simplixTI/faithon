// FaithOn — Bible RAG retrieval
// Uses pgvector to find relevant Bible verses for a given user message.

const { OpenAI } = require('openai');
const { supabase } = require('./supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Search for relevant Bible verses.
 * @param {string} query User message or topic
 * @param {number} limit Max verses to return
 * @returns {Promise<Array<{book, chapter, verse, text, translation, similarity}>>}
 */
async function searchBibleVerses(query, limit = 5) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not set, skipping Bible RAG');
    return [];
  }

  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc('match_bible_verses', {
    query_embedding: embedding,
    match_threshold: 0.78,
    match_count: limit,
  });

  if (error) {
    console.error('Bible RAG error:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Format verses as context for the AI system prompt.
 */
function formatBibleContext(verses) {
  if (!verses || verses.length === 0) return null;
  const lines = verses.map((v) => `${v.book} ${v.chapter}:${v.verse} (${v.translation}): "${v.text}"`);
  return lines.join('\n');
}

module.exports = {
  searchBibleVerses,
  formatBibleContext,
};

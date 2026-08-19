// Vectorize the NIV Bible into Supabase pgvector.
// Requires: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   OPENAI_API_KEY=sk-... node scripts/vectorize-bible.js
//
// This is a one-off seeding script. Safe to re-run (skips existing verses).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const BIBLE_DIR = path.join(__dirname, '..', 'data', 'bible-niv', 'Bible-niv-main');
const BATCH_SIZE = 100;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getExistingVerses() {
  const { data } = await supabase
    .from('bible_verses')
    .select('book, chapter, verse');
  const set = new Set();
  for (const row of data || []) {
    set.add(`${row.book}|${row.chapter}|${row.verse}`);
  }
  return set;
}

async function embedBatch(texts) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required');
    process.exit(1);
  }

  console.log('Loading existing verses...');
  const existing = await getExistingVerses();
  console.log(`Found ${existing.size} already in DB.`);

  const files = fs.readdirSync(BIBLE_DIR).filter((f) => f.endsWith('.json') && f !== 'Books.json');
  console.log(`Found ${files.length} book files.`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let batch = [];

  for (const file of files) {
    const bookPath = path.join(BIBLE_DIR, file);
    const bookData = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
    const bookName = bookData.book;

    for (const chapterData of bookData.chapters) {
      const chapter = chapterData.chapter;
      for (const verseData of chapterData.verses) {
        const verse = verseData.verse;
        const text = verseData.text;
        const key = `${bookName}|${chapter}|${verse}`;

        if (existing.has(key)) {
          totalSkipped++;
          continue;
        }

        batch.push({ book: bookName, chapter, verse, text, translation: 'NIV' });

        if (batch.length >= BATCH_SIZE) {
          await processBatch(batch);
          totalInserted += batch.length;
          console.log(`Inserted ${totalInserted} verses (${totalSkipped} skipped)...`);
          batch = [];
        }
      }
    }
  }

  if (batch.length > 0) {
    await processBatch(batch);
    totalInserted += batch.length;
    console.log(`Inserted final batch of ${batch.length} verses.`);
  }

  console.log(`Done. Total inserted: ${totalInserted}, skipped: ${totalSkipped}`);
}

async function processBatch(batch) {
  const texts = batch.map((v) => `${v.book} ${v.chapter}:${v.verse} ${v.text}`);
  const embeddings = await embedBatch(texts);

  const rows = batch.map((v, i) => ({
    book: v.book,
    chapter: v.chapter,
    verse: v.verse,
    text: v.text,
    translation: v.translation,
    embedding: embeddings[i],
  }));

  const { error } = await supabase.from('bible_verses').insert(rows);
  if (error) throw new Error(`insert error: ${error.message}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

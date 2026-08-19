-- =============================================================
-- FaithOn — Bible vectorized knowledge base (RAG)
-- Uses pgvector for semantic search of biblical passages.
-- =============================================================

create extension if not exists vector;

-- ---------- Bible verses with embeddings ----------
create table if not exists public.bible_verses (
  id uuid primary key default gen_random_uuid(),
  book text not null,
  chapter integer not null,
  verse integer not null,
  text text not null,
  translation text not null default 'ARA',
  themes text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists idx_bible_verses_book_chapter
  on public.bible_verses(book, chapter, verse);
create index if not exists idx_bible_verses_themes
  on public.bible_verses using gin(themes);
create index if not exists idx_bible_verses_embedding
  on public.bible_verses using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------- RAG retrieval function ----------
create or replace function public.match_bible_verses(
  query_embedding vector(1536),
  match_threshold float default 0.78,
  match_count int default 5
)
returns table (
  id uuid,
  book text,
  chapter integer,
  verse integer,
  text text,
  translation text,
  similarity float
)
language sql stable
as $$
  select
    id,
    book,
    chapter,
    verse,
    text,
    translation,
    1 - (embedding <=> query_embedding) as similarity
  from public.bible_verses
  where embedding is not null
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

comment on table public.bible_verses is
  'Vectorized Bible verses for RAG retrieval. Populated offline, queried by AI at runtime.';

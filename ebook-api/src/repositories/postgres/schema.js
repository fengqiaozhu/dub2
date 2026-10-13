const db = require('./db');

const schemaSql = `
CREATE TABLE IF NOT EXISTS books (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  author TEXT,
  description TEXT,
  language TEXT,
  tags TEXT,
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  publisher TEXT,
  publish_year INTEGER,
  isbn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chapters (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT,
  chapter_index INTEGER,
  ai_analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  type TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  progress INTEGER DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chapter_characters (
  id BIGSERIAL PRIMARY KEY,
  chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, character_name)
);

CREATE TABLE IF NOT EXISTS chapter_segments (
  id BIGSERIAL PRIMARY KEY,
  chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  segment_type TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, segment_index)
);

CREATE TABLE IF NOT EXISTS dialogues (
  id BIGSERIAL PRIMARY KEY,
  chapter_character_id BIGINT NOT NULL REFERENCES chapter_characters(id) ON DELETE CASCADE,
  segment_id BIGINT REFERENCES chapter_segments(id) ON DELETE SET NULL,
  chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  emotion TEXT NOT NULL DEFAULT '',
  char_start INTEGER DEFAULT -1,
  char_end INTEGER DEFAULT -1,
  source TEXT NOT NULL DEFAULT 'ai',
  annotation_status TEXT NOT NULL DEFAULT 'ai',
  updated_by TEXT,
  order_index INTEGER DEFAULT 0,
  audio_url TEXT,
  audio_duration REAL,
  audio_source_hash TEXT,
  audio_error TEXT,
  audio_status TEXT NOT NULL DEFAULT 'missing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_characters (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  dialogue_count INTEGER DEFAULT 0,
  chapter_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, character_name)
);

CREATE TABLE IF NOT EXISTS character_voice_bindings (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  voice_source TEXT NOT NULL DEFAULT 'system',
  provider TEXT NOT NULL DEFAULT 'mosi',
  provider_voice_id TEXT,
  voice_profile_id BIGINT,
  tts_model TEXT,
  intent_defaults TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, character_name)
);

CREATE TABLE IF NOT EXISTS voice_profiles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sample_text TEXT,
  sample_audio_url TEXT,
  sample_hash TEXT,
  language TEXT,
  speaker_meta TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown',
  quality_meta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_voices (
  id BIGSERIAL PRIMARY KEY,
  voice_profile_id BIGINT REFERENCES voice_profiles(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_voice_id TEXT NOT NULL,
  provider_model TEXT,
  kind TEXT NOT NULL DEFAULT 'clone',
  status TEXT,
  capabilities_snapshot TEXT,
  provider_meta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_voice_id)
);

CREATE TABLE IF NOT EXISTS voice_favorites (
  id BIGSERIAL PRIMARY KEY,
  favorite_key TEXT NOT NULL UNIQUE,
  provider TEXT,
  provider_voice_id TEXT,
  voice_source TEXT NOT NULL DEFAULT 'clone',
  voice_profile_id BIGINT REFERENCES voice_profiles(id) ON DELETE SET NULL,
  name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chapter_audio_exports (
  id BIGSERIAL PRIMARY KEY,
  chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'wav',
  source_hash TEXT NOT NULL,
  item_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chapter_audio_skip_ranges (
  id BIGSERIAL PRIMARY KEY,
  chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, char_start, char_end)
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id BIGSERIAL PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL,
  content_type TEXT,
  byte_size BIGINT,
  sha256 TEXT,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
CREATE INDEX IF NOT EXISTS idx_dialogues_chapter_id ON dialogues(chapter_id);
CREATE INDEX IF NOT EXISTS idx_dialogues_segment_id ON dialogues(segment_id);
CREATE INDEX IF NOT EXISTS idx_chapter_characters_book_id ON chapter_characters(book_id);
CREATE INDEX IF NOT EXISTS idx_provider_voices_profile_id ON provider_voices(voice_profile_id);
CREATE INDEX IF NOT EXISTS idx_storage_objects_entity ON storage_objects(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS book_character_profiles (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  first_chapter_id BIGINT REFERENCES chapters(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, canonical_name)
);

CREATE TABLE IF NOT EXISTS book_character_aliases (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES book_character_profiles(id) ON DELETE CASCADE,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, alias)
);

CREATE TABLE IF NOT EXISTS pronunciation_rules (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  profile_id BIGINT REFERENCES book_character_profiles(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL DEFAULT 'alias',
  match_text TEXT NOT NULL,
  replacement TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_character_aliases_profile_id ON book_character_aliases(profile_id);
CREATE INDEX IF NOT EXISTS idx_pronunciation_rules_book_id ON pronunciation_rules(book_id, enabled);

-- Repeatable backfill: one profile + a same-name alias per existing
-- book_characters.character_name. Safe to run again (no duplicate rows).
INSERT INTO book_character_profiles (book_id, canonical_name)
SELECT DISTINCT bc.book_id, bc.character_name
FROM book_characters bc
ON CONFLICT (book_id, canonical_name) DO NOTHING;

INSERT INTO book_character_aliases (book_id, profile_id, alias)
SELECT p.book_id, p.id, bc.character_name
FROM book_characters bc
JOIN book_character_profiles p ON p.book_id = bc.book_id AND p.canonical_name = bc.character_name
ON CONFLICT (book_id, alias) DO NOTHING;

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_usage (
  provider TEXT PRIMARY KEY,
  request_count BIGINT NOT NULL DEFAULT 0,
  total_credit_cost NUMERIC NOT NULL DEFAULT 0,
  last_credit_cost NUMERIC,
  last_used_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_configs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  is_reasoning BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tts_configs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_url TEXT,
  api_key TEXT,
  model TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tts_configs ADD COLUMN IF NOT EXISTS model TEXT;

WITH ranked_active_tts_configs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY provider
      ORDER BY updated_at DESC, id DESC
    ) AS active_rank
  FROM tts_configs
  WHERE is_active = TRUE
)
UPDATE tts_configs
SET is_active = FALSE, updated_at = NOW()
WHERE id IN (
  SELECT id
  FROM ranked_active_tts_configs
  WHERE active_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tts_configs_active_provider
  ON tts_configs (provider)
  WHERE is_active = TRUE;
`;

async function initSchema() {
  await db.query(schemaSql);
}

// Repeatable per-book backfill: one profile + a same-name alias per existing
// book_characters.character_name. Safe to run again (no duplicate rows).
async function backfillCharacterProfiles(bookId) {
  await db.query(
    `INSERT INTO book_character_profiles (book_id, canonical_name)
     SELECT DISTINCT bc.book_id, bc.character_name
     FROM book_characters bc
     WHERE bc.book_id = $1
     ON CONFLICT (book_id, canonical_name) DO NOTHING`,
    [bookId]
  );
  await db.query(
    `INSERT INTO book_character_aliases (book_id, profile_id, alias)
     SELECT p.book_id, p.id, bc.character_name
     FROM book_characters bc
     JOIN book_character_profiles p ON p.book_id = bc.book_id AND p.canonical_name = bc.character_name
     WHERE bc.book_id = $1
     ON CONFLICT (book_id, alias) DO NOTHING`,
    [bookId]
  );
}

module.exports = {
  initSchema,
  backfillCharacterProfiles,
  schemaSql
};

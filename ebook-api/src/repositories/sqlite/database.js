const Database = require('better-sqlite3');
const path = require('path');

class SQLiteDatabase {
  constructor() {
    if (!SQLiteDatabase.instance) {
      const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../database.sqlite');
      this.db = new Database(dbPath, { verbose: console.log });
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      this.initTables();
      SQLiteDatabase.instance = this;
    }
    return SQLiteDatabase.instance;
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        title TEXT,
        content TEXT,
        chapter_index INTEGER,
        ai_analysis TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapter_characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        character_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
        UNIQUE (chapter_id, character_name)
      );

      CREATE TABLE IF NOT EXISTS chapter_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        segment_index INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        segment_type TEXT NOT NULL DEFAULT 'unknown',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
        UNIQUE (chapter_id, segment_index)
      );

      CREATE TABLE IF NOT EXISTS dialogues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_character_id INTEGER NOT NULL,
        segment_id INTEGER,
        chapter_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT NOT NULL DEFAULT '',
        char_start INTEGER DEFAULT -1,
        char_end INTEGER DEFAULT -1,
        source TEXT NOT NULL DEFAULT 'ai',
        annotation_status TEXT NOT NULL DEFAULT 'ai',
        updated_by TEXT,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chapter_character_id) REFERENCES chapter_characters (id) ON DELETE CASCADE,
        FOREIGN KEY (segment_id) REFERENCES chapter_segments (id) ON DELETE SET NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS book_characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        character_name TEXT NOT NULL,
        dialogue_count INTEGER DEFAULT 0,
        chapter_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
        UNIQUE (book_id, character_name)
      );

      CREATE TABLE IF NOT EXISTS character_voice_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        character_name TEXT NOT NULL,
        voice_id TEXT NOT NULL,
        voice_source TEXT NOT NULL DEFAULT 'system',
        provider TEXT NOT NULL DEFAULT 'mosi',
        provider_voice_id TEXT,
        voice_profile_id INTEGER,
        tts_model TEXT,
        intent_defaults TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
        UNIQUE (book_id, character_name)
      );

      CREATE TABLE IF NOT EXISTS voice_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        sample_text TEXT,
        sample_audio_url TEXT,
        language TEXT,
        speaker_meta TEXT,
        consent_status TEXT NOT NULL DEFAULT 'unknown',
        quality_meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS provider_voices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voice_profile_id INTEGER,
        provider TEXT NOT NULL,
        provider_voice_id TEXT NOT NULL,
        provider_model TEXT,
        kind TEXT NOT NULL DEFAULT 'clone',
        status TEXT,
        capabilities_snapshot TEXT,
        provider_meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles (id) ON DELETE SET NULL,
        UNIQUE (provider, provider_voice_id)
      );

      CREATE TABLE IF NOT EXISTS voice_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        favorite_key TEXT NOT NULL UNIQUE,
        provider TEXT,
        provider_voice_id TEXT,
        voice_source TEXT NOT NULL DEFAULT 'clone',
        voice_profile_id INTEGER,
        name_snapshot TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles (id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS chapter_audio_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        audio_url TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'wav',
        source_hash TEXT NOT NULL,
        item_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chapter_audio_skip_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
        UNIQUE (chapter_id, char_start, char_end)
      );
    `);

    // Schema migrations for existing databases
    try {
      this.db.exec(`ALTER TABLE dialogues ADD COLUMN audio_url TEXT;`);
    } catch (e) { /* Ignore if column already exists */ }
    
    try {
      this.db.exec(`ALTER TABLE dialogues ADD COLUMN audio_duration REAL;`);
    } catch (e) { /* Ignore if column already exists */ }

    const migrations = [
      `ALTER TABLE dialogues ADD COLUMN segment_id INTEGER;`,
      `ALTER TABLE dialogues ADD COLUMN annotation_status TEXT NOT NULL DEFAULT 'ai';`,
      `ALTER TABLE dialogues ADD COLUMN updated_by TEXT;`,
      `ALTER TABLE dialogues ADD COLUMN audio_source_hash TEXT;`,
      `ALTER TABLE dialogues ADD COLUMN audio_error TEXT;`,
      `ALTER TABLE dialogues ADD COLUMN audio_status TEXT NOT NULL DEFAULT 'missing';`,
      `ALTER TABLE character_voice_bindings ADD COLUMN provider TEXT NOT NULL DEFAULT 'mosi';`,
      `ALTER TABLE character_voice_bindings ADD COLUMN provider_voice_id TEXT;`,
      `ALTER TABLE character_voice_bindings ADD COLUMN voice_profile_id INTEGER;`,
      `ALTER TABLE character_voice_bindings ADD COLUMN tts_model TEXT;`,
      `ALTER TABLE character_voice_bindings ADD COLUMN intent_defaults TEXT;`,
      // Book metadata fields
      `ALTER TABLE books ADD COLUMN author TEXT;`,
      `ALTER TABLE books ADD COLUMN description TEXT;`,
      `ALTER TABLE books ADD COLUMN language TEXT;`,
      `ALTER TABLE books ADD COLUMN tags TEXT;`,
      `ALTER TABLE books ADD COLUMN cover_url TEXT;`,
      `ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';`,
      `ALTER TABLE books ADD COLUMN publisher TEXT;`,
      `ALTER TABLE books ADD COLUMN publish_year INTEGER;`,
      `ALTER TABLE books ADD COLUMN isbn TEXT;`
    ];

    for (const migration of migrations) {
      try {
        this.db.exec(migration);
      } catch (e) { /* Ignore if column already exists */ }
    }

    this.db.exec(`
      UPDATE character_voice_bindings
      SET provider = COALESCE(provider, 'mosi'),
          provider_voice_id = COALESCE(provider_voice_id, voice_id)
      WHERE provider_voice_id IS NULL OR provider IS NULL;

      UPDATE character_voice_bindings
      SET provider_voice_id = NULL
      WHERE provider_voice_id LIKE 'profile:%';
    `);
  }

  getDb() {
    return this.db;
  }
}

module.exports = new SQLiteDatabase();

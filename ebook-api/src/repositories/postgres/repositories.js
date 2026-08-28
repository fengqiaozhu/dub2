const db = require('./db');

function buildFavoriteKey({ provider, provider_voice_id, voice_profile_id, voice_source }) {
  if (provider_voice_id) return `${provider || 'mosi'}:${voice_source || 'clone'}:${provider_voice_id}`;
  if (voice_profile_id === undefined || voice_profile_id === null) return '';
  return `profile:${voice_profile_id}`;
}

function jsonOrNull(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseJsonField(row, field) {
  if (!row || !row[field] || typeof row[field] !== 'string') return row;
  try {
    row[field] = JSON.parse(row[field]);
  } catch (error) {
    // Keep legacy strings as-is.
  }
  return row;
}

function buildUpdate(updates, allowed, startIndex = 1) {
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      values.push(updates[key]);
      fields.push(`${key} = $${startIndex + values.length - 1}`);
    }
  }
  return { fields, values };
}

class BookRepository {
  async create(book) {
    const fields = ['title', 'format'];
    const values = [book.title, book.format];
    const optional = ['author', 'description', 'language', 'tags', 'cover_url', 'status', 'publisher', 'publish_year', 'isbn'];
    for (const key of optional) {
      if (book[key] !== undefined && book[key] !== null) {
        fields.push(key);
        values.push(book[key]);
      }
    }
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const row = await db.one(`INSERT INTO books (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`, values);
    return row.id;
  }

  async update(id, updates) {
    const { fields, values } = buildUpdate(updates, ['title', 'format', 'author', 'description', 'language', 'tags', 'cover_url', 'status', 'publisher', 'publish_year', 'isbn']);
    if (fields.length === 0) return false;
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await db.query(`UPDATE books SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    return result.rowCount > 0;
  }

  async findById(id) {
    return db.one('SELECT * FROM books WHERE id = $1', [id]);
  }

  async findAll(options = {}) {
    const { q, sort, order } = options;
    const values = [];
    let sql = `
      SELECT b.*, COUNT(c.id)::int AS chapter_count
      FROM books b
      LEFT JOIN chapters c ON c.book_id = b.id
    `;
    if (q) {
      values.push(`%${q}%`, `%${q}%`);
      sql += ` WHERE (b.title ILIKE $1 OR b.author ILIKE $2)`;
    }
    sql += ` GROUP BY b.id`;
    const allowedSorts = ['title', 'created_at', 'author'];
    const sortCol = allowedSorts.includes(sort) ? `b.${sort}` : 'b.created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;
    return db.many(sql, values);
  }

  async count() {
    const row = await db.one('SELECT COUNT(*)::int AS total FROM books');
    return row.total;
  }

  async delete(id) {
    const result = await db.query('DELETE FROM books WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

class ChapterRepository {
  async create(chapter) {
    const row = await db.one(`
      INSERT INTO chapters (book_id, title, content, chapter_index)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [chapter.book_id, chapter.title, chapter.content, chapter.chapter_index]);
    return row.id;
  }

  async createMany(chapters) {
    await db.transaction(async (tx) => {
      for (const chapter of chapters) {
        await tx.query(`
          INSERT INTO chapters (book_id, title, content, chapter_index)
          VALUES ($1, $2, $3, $4)
        `, [chapter.book_id, chapter.title, chapter.content, chapter.chapter_index]);
      }
    });
  }

  async findByBookId(bookId) {
    return db.many(`
      SELECT id, book_id, title, chapter_index, created_at, ai_analysis
      FROM chapters
      WHERE book_id = $1
      ORDER BY chapter_index ASC
    `, [bookId]);
  }

  async getNextChapterIndex(bookId) {
    const row = await db.one('SELECT COALESCE(MAX(chapter_index), -1) + 1 AS next_index FROM chapters WHERE book_id = $1', [bookId]);
    return row.next_index;
  }

  async findById(id) {
    return db.one('SELECT * FROM chapters WHERE id = $1', [id]);
  }

  async update(id, updates) {
    const { fields, values } = buildUpdate(updates, ['title', 'content', 'chapter_index', 'ai_analysis']);
    if (fields.length === 0) return false;
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await db.query(`UPDATE chapters SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    return result.rowCount > 0;
  }

  async delete(id) {
    const result = await db.query('DELETE FROM chapters WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

class ChapterSegmentRepository {
  async createMany(chapterId, segments) {
    await db.transaction(async (tx) => {
      for (const segment of segments) {
        await tx.query(`
          INSERT INTO chapter_segments (chapter_id, content, segment_index, char_start, char_end, segment_type)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [chapterId, segment.content, segment.segment_index, segment.char_start, segment.char_end, segment.segment_type || 'unknown']);
      }
    });
  }

  async replaceForChapter(chapterId, segments) {
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM chapter_segments WHERE chapter_id = $1', [chapterId]);
      for (const segment of segments) {
        await tx.query(`
          INSERT INTO chapter_segments (chapter_id, content, segment_index, char_start, char_end, segment_type)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [chapterId, segment.content, segment.segment_index, segment.char_start, segment.char_end, segment.segment_type || 'unknown']);
      }
    });
  }

  async findByChapterId(chapterId) {
    return db.many(`
      SELECT *
      FROM chapter_segments
      WHERE chapter_id = $1
      ORDER BY segment_index ASC, id ASC
    `, [chapterId]);
  }

  async findById(id) {
    return db.one('SELECT * FROM chapter_segments WHERE id = $1', [id]);
  }

  async updateType(id, segmentType) {
    const result = await db.query(`
      UPDATE chapter_segments
      SET segment_type = $1, updated_at = NOW()
      WHERE id = $2
    `, [segmentType, id]);
    return result.rowCount > 0;
  }

  async deleteByChapterId(chapterId) {
    const result = await db.query('DELETE FROM chapter_segments WHERE chapter_id = $1', [chapterId]);
    return result.rowCount;
  }

  attachDialogues(segments, dialogues) {
    const bySegmentId = new Map();
    for (const dialogue of dialogues) {
      if (dialogue.segment_id) bySegmentId.set(dialogue.segment_id, dialogue);
    }
    return segments.map((segment) => ({
      ...segment,
      dialogue: bySegmentId.get(segment.id) || null
    }));
  }
}

class ChapterCharacterRepository {
  async upsert(chapterId, bookId, characterName) {
    const row = await db.one(`
      INSERT INTO chapter_characters (chapter_id, book_id, character_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (chapter_id, character_name) DO UPDATE SET character_name = EXCLUDED.character_name
      RETURNING id
    `, [chapterId, bookId, characterName]);
    return row.id;
  }

  async findByChapterId(chapterId) {
    return db.many(`
      SELECT cc.*, COUNT(d.id)::int AS dialogue_count
      FROM chapter_characters cc
      LEFT JOIN dialogues d ON d.chapter_character_id = cc.id
      WHERE cc.chapter_id = $1
      GROUP BY cc.id
      ORDER BY cc.id ASC
    `, [chapterId]);
  }

  async deleteByChapterId(chapterId) {
    const result = await db.query('DELETE FROM chapter_characters WHERE chapter_id = $1', [chapterId]);
    return result.rowCount;
  }

  async deleteUnusedByChapterId(chapterId) {
    const result = await db.query(`
      DELETE FROM chapter_characters
      WHERE chapter_id = $1
        AND id NOT IN (
          SELECT DISTINCT chapter_character_id
          FROM dialogues
          WHERE chapter_id = $2
        )
    `, [chapterId, chapterId]);
    return result.rowCount;
  }

  async findById(id) {
    return db.one('SELECT * FROM chapter_characters WHERE id = $1', [id]);
  }
}

class DialogueRepository {
  async createMany(dialogues) {
    await db.transaction(async (tx) => {
      for (const d of dialogues) {
        await tx.query(`
          INSERT INTO dialogues (
            chapter_character_id, segment_id, chapter_id, content, emotion, char_start, char_end,
            source, annotation_status, updated_by, order_index
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          d.chapter_character_id,
          d.segment_id ?? null,
          d.chapter_id,
          d.content,
          d.emotion ?? '',
          d.char_start ?? -1,
          d.char_end ?? -1,
          d.source ?? 'ai',
          d.annotation_status ?? (d.source === 'manual' ? 'manual' : 'ai'),
          d.updated_by ?? null,
          d.order_index ?? 0
        ]);
      }
    });
  }

  async create(dialogue) {
    const row = await db.one(`
      INSERT INTO dialogues (
        chapter_character_id, segment_id, chapter_id, content, emotion, char_start, char_end,
        source, annotation_status, updated_by, order_index
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      dialogue.chapter_character_id,
      dialogue.segment_id ?? null,
      dialogue.chapter_id,
      dialogue.content,
      dialogue.emotion ?? '',
      dialogue.char_start ?? -1,
      dialogue.char_end ?? -1,
      dialogue.source ?? 'manual',
      dialogue.annotation_status ?? (dialogue.source === 'ai' ? 'ai' : 'manual'),
      dialogue.updated_by ?? null,
      dialogue.order_index ?? 0
    ]);
    return row.id;
  }

  async findByChapterCharacterId(chapterCharacterId) {
    return db.many(`
      SELECT d.*
      FROM dialogues d
      WHERE d.chapter_character_id = $1
      ORDER BY d.char_start ASC, d.order_index ASC, d.id ASC
    `, [chapterCharacterId]);
  }

  async findByChapterId(chapterId) {
    return db.many(`
      SELECT d.*, cc.character_name
      FROM dialogues d
      JOIN chapter_characters cc ON cc.id = d.chapter_character_id
      WHERE d.chapter_id = $1
      ORDER BY d.char_start ASC, d.order_index ASC, d.id ASC
    `, [chapterId]);
  }

  async clearAudioByChapterId(chapterId) {
    const result = await db.query(`
      UPDATE dialogues
      SET audio_url = NULL,
          audio_duration = NULL,
          audio_source_hash = NULL,
          audio_error = NULL,
          audio_status = 'missing',
          updated_at = NOW()
      WHERE chapter_id = $1
    `, [chapterId]);
    return result.rowCount;
  }

  async clearAudioById(id) {
    const result = await db.query(`
      UPDATE dialogues
      SET audio_url = NULL,
          audio_duration = NULL,
          audio_source_hash = NULL,
          audio_error = NULL,
          audio_status = 'missing',
          updated_at = NOW()
      WHERE id = $1
    `, [id]);
    return result.rowCount > 0;
  }

  async findById(id) {
    return db.one(`
      SELECT d.*, cc.character_name, cc.book_id
      FROM dialogues d
      JOIN chapter_characters cc ON cc.id = d.chapter_character_id
      WHERE d.id = $1
    `, [id]);
  }

  async findBySegmentId(segmentId) {
    return db.one(`
      SELECT d.*, cc.character_name
      FROM dialogues d
      JOIN chapter_characters cc ON cc.id = d.chapter_character_id
      WHERE d.segment_id = $1
      ORDER BY d.id ASC
      LIMIT 1
    `, [segmentId]);
  }

  async update(id, updates) {
    const allowed = [
      'chapter_character_id',
      'segment_id',
      'content',
      'emotion',
      'char_start',
      'char_end',
      'source',
      'annotation_status',
      'updated_by',
      'order_index',
      'audio_url',
      'audio_duration',
      'audio_source_hash',
      'audio_error',
      'audio_status'
    ];
    const { fields, values } = buildUpdate(updates, allowed);
    if (fields.length === 0) return false;
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await db.query(`UPDATE dialogues SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    return result.rowCount > 0;
  }

  async delete(id) {
    const result = await db.query('DELETE FROM dialogues WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async deleteByChapterIdAndSource(chapterId, source) {
    const result = await db.query('DELETE FROM dialogues WHERE chapter_id = $1 AND source = $2', [chapterId, source]);
    return result.rowCount;
  }

  async deleteByChapterId(chapterId) {
    const result = await db.query('DELETE FROM dialogues WHERE chapter_id = $1', [chapterId]);
    return result.rowCount;
  }

  async deleteBySegmentId(segmentId) {
    const result = await db.query('DELETE FROM dialogues WHERE segment_id = $1', [segmentId]);
    return result.rowCount;
  }
}

class BookCharacterRepository {
  async upsert(bookId, characterName, dialogueCountDelta, chapterCountDelta) {
    await db.query(`
      INSERT INTO book_characters (book_id, character_name, dialogue_count, chapter_count)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (book_id, character_name) DO UPDATE SET
        dialogue_count = book_characters.dialogue_count + EXCLUDED.dialogue_count,
        chapter_count = book_characters.chapter_count + EXCLUDED.chapter_count
    `, [bookId, characterName, dialogueCountDelta, chapterCountDelta]);
  }

  async recalculateForBook(bookId) {
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM book_characters WHERE book_id = $1', [bookId]);
      await tx.query(`
        INSERT INTO book_characters (book_id, character_name, dialogue_count, chapter_count)
        SELECT
          cc.book_id,
          cc.character_name,
          COUNT(d.id)::int AS dialogue_count,
          COUNT(DISTINCT cc.chapter_id)::int AS chapter_count
        FROM chapter_characters cc
        JOIN dialogues d ON d.chapter_character_id = cc.id
        WHERE cc.book_id = $1
        GROUP BY cc.book_id, cc.character_name
      `, [bookId]);
    });
  }

  async findByBookId(bookId) {
    return db.many(`
      SELECT
        bc.*,
        cvb.voice_id,
        cvb.voice_source,
        cvb.provider,
        cvb.provider_voice_id,
        cvb.voice_profile_id,
        cvb.tts_model,
        cvb.intent_defaults
      FROM book_characters bc
      LEFT JOIN character_voice_bindings cvb
        ON cvb.book_id = bc.book_id AND cvb.character_name = bc.character_name
      WHERE bc.book_id = $1
      ORDER BY bc.dialogue_count DESC
    `, [bookId]);
  }
}

class CharacterVoiceBindingRepository {
  async upsert(bookId, characterName, voiceIdOrBinding, voiceSource = 'system') {
    const binding = typeof voiceIdOrBinding === 'object'
      ? voiceIdOrBinding
      : { voice_id: voiceIdOrBinding, voice_source: voiceSource };
    const voiceId = binding.voice_id || binding.provider_voice_id;
    const source = binding.voice_source || voiceSource || 'system';
    const provider = binding.provider || 'mosi';
    const providerVoiceId = binding.provider_voice_id || (
      voiceId && !String(voiceId).startsWith('profile:') ? voiceId : null
    );
    const intentDefaults = jsonOrNull(binding.intent_defaults);
    await db.query(`
      INSERT INTO character_voice_bindings (
        book_id, character_name, voice_id, voice_source, provider,
        provider_voice_id, voice_profile_id, tts_model, intent_defaults
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (book_id, character_name) DO UPDATE SET
        voice_id = EXCLUDED.voice_id,
        voice_source = EXCLUDED.voice_source,
        provider = EXCLUDED.provider,
        provider_voice_id = EXCLUDED.provider_voice_id,
        voice_profile_id = EXCLUDED.voice_profile_id,
        tts_model = EXCLUDED.tts_model,
        intent_defaults = EXCLUDED.intent_defaults,
        updated_at = NOW()
    `, [
      bookId,
      characterName,
      voiceId,
      source,
      provider,
      providerVoiceId,
      binding.voice_profile_id || null,
      binding.tts_model || null,
      intentDefaults
    ]);
  }

  async findByBookId(bookId) {
    return db.many('SELECT * FROM character_voice_bindings WHERE book_id = $1 ORDER BY character_name ASC', [bookId]);
  }

  async findVoiceUsageByBookId(bookId) {
    return db.many(`
      SELECT
        cvb.provider,
        cvb.provider_voice_id,
        cvb.voice_id,
        cvb.voice_source,
        cvb.voice_profile_id,
        COUNT(cvb.id)::int AS role_count,
        COALESCE(SUM(bc.dialogue_count), 0)::int AS dialogue_count,
        COALESCE(SUM(bc.chapter_count), 0)::int AS chapter_count
      FROM character_voice_bindings cvb
      LEFT JOIN book_characters bc
        ON bc.book_id = cvb.book_id AND bc.character_name = cvb.character_name
      WHERE cvb.book_id = $1
      GROUP BY cvb.provider, cvb.provider_voice_id, cvb.voice_id, cvb.voice_source, cvb.voice_profile_id
      ORDER BY dialogue_count DESC, role_count DESC
    `, [bookId]);
  }

  async findOne(bookId, characterName) {
    return db.one('SELECT * FROM character_voice_bindings WHERE book_id = $1 AND character_name = $2', [bookId, characterName]);
  }

  async delete(bookId, characterName) {
    const result = await db.query('DELETE FROM character_voice_bindings WHERE book_id = $1 AND character_name = $2', [bookId, characterName]);
    return result.rowCount > 0;
  }
}

class ChapterAudioExportRepository {
  async findLatestByChapterId(chapterId) {
    return db.one(`
      SELECT *
      FROM chapter_audio_exports
      WHERE chapter_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `, [chapterId]);
  }

  async create(exportRecord) {
    const row = await db.one(`
      INSERT INTO chapter_audio_exports (chapter_id, audio_url, format, source_hash, item_count)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      exportRecord.chapter_id,
      exportRecord.audio_url,
      exportRecord.format || 'wav',
      exportRecord.source_hash,
      exportRecord.item_count || 0
    ]);
    return row.id;
  }

  async deleteByChapterId(chapterId) {
    const result = await db.query('DELETE FROM chapter_audio_exports WHERE chapter_id = $1', [chapterId]);
    return result.rowCount;
  }
}

class ChapterAudioSkipRangeRepository {
  async findByChapterId(chapterId) {
    return db.many(`
      SELECT *
      FROM chapter_audio_skip_ranges
      WHERE chapter_id = $1
      ORDER BY char_start ASC, char_end ASC, id ASC
    `, [chapterId]);
  }

  async upsert(chapterId, charStart, charEnd) {
    const row = await db.one(`
      INSERT INTO chapter_audio_skip_ranges (chapter_id, char_start, char_end)
      VALUES ($1, $2, $3)
      ON CONFLICT (chapter_id, char_start, char_end)
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    `, [chapterId, charStart, charEnd]);
    return row.id;
  }

  async deleteRange(chapterId, charStart, charEnd) {
    const result = await db.query(`
      DELETE FROM chapter_audio_skip_ranges
      WHERE chapter_id = $1 AND char_start = $2 AND char_end = $3
    `, [chapterId, charStart, charEnd]);
    return result.rowCount;
  }

  async deleteByChapterId(chapterId) {
    const result = await db.query('DELETE FROM chapter_audio_skip_ranges WHERE chapter_id = $1', [chapterId]);
    return result.rowCount;
  }
}

class VoiceProfileRepository {
  async create(profile) {
    const row = await db.one(`
      INSERT INTO voice_profiles (
        name, description, sample_text, sample_audio_url, sample_hash, language,
        speaker_meta, consent_status, quality_meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      profile.name,
      profile.description || null,
      profile.sample_text || null,
      profile.sample_audio_url || null,
      profile.sample_hash || null,
      profile.language || null,
      jsonOrNull(profile.speaker_meta),
      profile.consent_status || 'unknown',
      jsonOrNull(profile.quality_meta)
    ]);
    return row.id;
  }

  async findById(id) {
    return db.one('SELECT * FROM voice_profiles WHERE id = $1', [id]);
  }

  async updateSampleHash(id, sampleHash) {
    await db.query(`
      UPDATE voice_profiles
      SET sample_hash = $1, updated_at = NOW()
      WHERE id = $2
    `, [sampleHash, id]);
  }

  async updateSampleAudio(id, sampleAudioUrl, sampleHash) {
    await db.query(`
      UPDATE voice_profiles
      SET sample_audio_url = $1,
          sample_hash = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [sampleAudioUrl, sampleHash, id]);
  }

  async delete(id) {
    const result = await db.query('DELETE FROM voice_profiles WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async findAll({ limit = 100, offset = 0, search } = {}) {
    const values = [];
    let where = '';
    if (search) {
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
      where = `WHERE vp.name ILIKE $1 OR vp.sample_text ILIKE $2 OR vp.language ILIKE $3`;
    }
    values.push(limit, offset);
    const limitIndex = values.length - 1;
    const offsetIndex = values.length;
    return db.many(`
      SELECT
        vp.*,
        COUNT(pv.id)::int AS provider_voice_count,
        STRING_AGG(pv.provider || ':' || COALESCE(pv.status, 'unknown'), ',') AS provider_statuses
      FROM voice_profiles vp
      LEFT JOIN provider_voices pv ON pv.voice_profile_id = vp.id
      ${where}
      GROUP BY vp.id
      ORDER BY vp.updated_at DESC, vp.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, values);
  }
}

class ProviderVoiceRepository {
  async upsert(voice) {
    await db.query(`
      INSERT INTO provider_voices (
        voice_profile_id, provider, provider_voice_id, provider_model, kind,
        status, capabilities_snapshot, provider_meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (provider, provider_voice_id) DO UPDATE SET
        voice_profile_id = EXCLUDED.voice_profile_id,
        provider_model = EXCLUDED.provider_model,
        kind = EXCLUDED.kind,
        status = EXCLUDED.status,
        capabilities_snapshot = EXCLUDED.capabilities_snapshot,
        provider_meta = EXCLUDED.provider_meta,
        updated_at = NOW()
    `, [
      voice.voice_profile_id || null,
      voice.provider,
      voice.provider_voice_id,
      voice.provider_model || null,
      voice.kind || 'clone',
      voice.status || null,
      jsonOrNull(voice.capabilities_snapshot),
      jsonOrNull(voice.provider_meta)
    ]);
  }

  async findByProviderVoiceId(provider, providerVoiceId) {
    return db.one(`
      SELECT
        pv.*,
        vp.name AS voice_profile_name,
        vp.sample_audio_url,
        vp.sample_text,
        vp.language AS profile_language,
        vp.consent_status
      FROM provider_voices pv
      LEFT JOIN voice_profiles vp ON vp.id = pv.voice_profile_id
      WHERE pv.provider = $1 AND pv.provider_voice_id = $2
    `, [provider, providerVoiceId]);
  }

  async findByProfileId(voiceProfileId) {
    return db.many('SELECT * FROM provider_voices WHERE voice_profile_id = $1', [voiceProfileId]);
  }

  async deleteMissingForProvider(provider, confirmedVoiceIds = []) {
    const ids = confirmedVoiceIds.filter(Boolean);
    if (ids.length === 0) {
      const result = await db.query(`
        DELETE FROM provider_voices
        WHERE provider = $1 AND kind IN ('clone', 'custom', 'imported')
      `, [provider]);
      return result.rowCount;
    }
    const result = await db.query(`
      DELETE FROM provider_voices
      WHERE provider = $1
        AND kind IN ('clone', 'custom', 'imported')
        AND provider_voice_id <> ALL($2::text[])
    `, [provider, ids]);
    return result.rowCount;
  }

  async findActiveByProfileId(voiceProfileId, provider) {
    const values = [voiceProfileId];
    let providerSql = '';
    if (provider) {
      values.push(provider);
      providerSql = `AND provider = $2`;
    }
    return db.one(`
      SELECT *
      FROM provider_voices
      WHERE voice_profile_id = $1
        ${providerSql}
        AND UPPER(COALESCE(status, 'ACTIVE')) IN ('ACTIVE', 'DONE')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `, values);
  }

  async findAll({ provider, kind, status, limit = 100, offset = 0 } = {}) {
    const conditions = [];
    const values = [];
    if (provider) {
      values.push(provider);
      conditions.push(`pv.provider = $${values.length}`);
    }
    if (kind) {
      values.push(kind);
      conditions.push(`pv.kind = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`pv.status = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit, offset);
    const rows = await db.many(`
      SELECT
        pv.*,
        vp.name AS voice_profile_name,
        vp.sample_audio_url,
        vp.sample_text,
        vp.language AS profile_language,
        vp.consent_status
      FROM provider_voices pv
      LEFT JOIN voice_profiles vp ON vp.id = pv.voice_profile_id
      ${where}
      ORDER BY pv.updated_at DESC, pv.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    return rows;
  }
}

class VoiceFavoriteRepository {
  async findAll() {
    return db.many('SELECT * FROM voice_favorites ORDER BY created_at DESC');
  }

  async upsert(favorite) {
    const favoriteKey = buildFavoriteKey(favorite);
    await db.query(`
      INSERT INTO voice_favorites (
        favorite_key, provider, provider_voice_id, voice_source, voice_profile_id, name_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (favorite_key) DO UPDATE SET
        provider = EXCLUDED.provider,
        provider_voice_id = EXCLUDED.provider_voice_id,
        voice_source = EXCLUDED.voice_source,
        voice_profile_id = EXCLUDED.voice_profile_id,
        name_snapshot = EXCLUDED.name_snapshot,
        updated_at = NOW()
    `, [
      favoriteKey,
      favorite.provider || null,
      favorite.provider_voice_id || null,
      favorite.voice_source || 'clone',
      favorite.voice_profile_id || null,
      favorite.name_snapshot || null
    ]);
    return this.findByKey(favoriteKey);
  }

  async findByKey(favoriteKey) {
    return db.one('SELECT * FROM voice_favorites WHERE favorite_key = $1', [favoriteKey]);
  }

  async delete(favorite) {
    const favoriteKey = buildFavoriteKey(favorite);
    const result = await db.query('DELETE FROM voice_favorites WHERE favorite_key = $1', [favoriteKey]);
    return result.rowCount > 0;
  }
}

VoiceFavoriteRepository.buildFavoriteKey = buildFavoriteKey;

class JobRepository {
  async create(job) {
    await db.query(`
      INSERT INTO jobs (id, job_name, type, target_id, status, progress)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      job.id,
      job.job_name,
      job.type,
      job.target_id || null,
      job.status || 'PENDING',
      job.progress || 0
    ]);
    return this.findById(job.id);
  }

  async findById(id) {
    const job = await db.one('SELECT * FROM jobs WHERE id = $1', [id]);
    return parseJsonField(job, 'result');
  }

  async findActiveByTypeAndTarget(type, targetId) {
    return db.one(`
      SELECT *
      FROM jobs
      WHERE type = $1 AND target_id = $2 AND status IN ('PENDING', 'RUNNING')
      ORDER BY created_at DESC
      LIMIT 1
    `, [type, targetId]);
  }

  async update(id, updates) {
    const normalized = { ...updates };
    if (normalized.result !== undefined && normalized.result !== null && typeof normalized.result !== 'string') {
      normalized.result = JSON.stringify(normalized.result);
    }
    const { fields, values } = buildUpdate(normalized, ['status', 'progress', 'result', 'error']);
    if (fields.length === 0) return this.findById(id);
    fields.push('updated_at = NOW()');
    values.push(id);
    await db.query(`UPDATE jobs SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    return this.findById(id);
  }

  async findAll(filters = {}) {
    const conditions = [];
    const values = [];
    if (filters.type) {
      values.push(filters.type);
      conditions.push(`type = $${values.length}`);
    }
    if (filters.target_id) {
      values.push(filters.target_id);
      conditions.push(`target_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }
    let sql = 'SELECT * FROM jobs';
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC';
    if (filters.limit) {
      values.push(filters.limit || 50, filters.offset || 0);
      sql += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }
    const jobs = await db.many(sql, values);
    return jobs.map((job) => parseJsonField(job, 'result'));
  }

  async findInterruptedBatchJobs() {
    return db.many(`
      SELECT *
      FROM jobs
      WHERE status IN ('PENDING', 'RUNNING') AND type = 'batch_dub'
    `);
  }

  async markStaleJobsAsFailed() {
    const result = await db.query(`
      UPDATE jobs
      SET status = 'FAILED',
          error = 'Server restarted before job completed',
          updated_at = NOW()
      WHERE status IN ('PENDING', 'RUNNING')
    `);
    return result.rowCount;
  }

  async cleanupOldJobs(daysToKeep = 7) {
    const result = await db.query(`
      DELETE FROM jobs
      WHERE status IN ('DONE', 'FAILED')
        AND created_at < NOW() - ($1::int * INTERVAL '1 day')
    `, [daysToKeep]);
    return result.rowCount;
  }
}

class StorageObjectRepository {
  async upsert(object) {
    await db.query(`
      INSERT INTO storage_objects (
        object_key, bucket, content_type, byte_size, sha256, entity_type, entity_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (object_key) DO UPDATE SET
        bucket = EXCLUDED.bucket,
        content_type = EXCLUDED.content_type,
        byte_size = EXCLUDED.byte_size,
        sha256 = EXCLUDED.sha256,
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `, [
      object.object_key,
      object.bucket,
      object.content_type || null,
      object.byte_size ?? null,
      object.sha256 || null,
      object.entity_type || null,
      object.entity_id || null,
      jsonOrNull(object.metadata)
    ]);
  }

  async findAll() {
    return db.many('SELECT * FROM storage_objects ORDER BY created_at ASC');
  }

  async findByKey(objectKey) {
    return db.one('SELECT * FROM storage_objects WHERE object_key = $1', [objectKey]);
  }

  async deleteByKey(objectKey) {
    const result = await db.query('DELETE FROM storage_objects WHERE object_key = $1', [objectKey]);
    return result.rowCount > 0;
  }
}

class SystemSettingRepository {
  async upsert(key, value) {
    const row = await db.one(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING key
    `, [key, value]);
    return row.key;
  }

  async findByKey(key) {
    return db.one('SELECT * FROM system_settings WHERE key = $1', [key]);
  }

  async getValue(key, defaultValue = null) {
    const row = await this.findByKey(key);
    return row ? row.value : defaultValue;
  }

  async findAll() {
    return db.many('SELECT * FROM system_settings ORDER BY key ASC');
  }

  async delete(key) {
    const result = await db.query('DELETE FROM system_settings WHERE key = $1', [key]);
    return result.rowCount > 0;
  }
}

function normalizeProviderUsage(row) {
  if (!row) return null;
  return {
    ...row,
    request_count: Number(row.request_count || 0),
    total_credit_cost: Number(row.total_credit_cost || 0),
    last_credit_cost: row.last_credit_cost === null || row.last_credit_cost === undefined
      ? null
      : Number(row.last_credit_cost)
  };
}

class ProviderUsageRepository {
  async findByProvider(provider) {
    const row = await db.one('SELECT * FROM provider_usage WHERE provider = $1', [provider]);
    return normalizeProviderUsage(row);
  }

  async recordSuccess(provider, creditCost = null) {
    const normalizedCost = creditCost === null || creditCost === undefined || creditCost === ''
      ? null
      : Number(creditCost);
    const lastCreditCost = normalizedCost !== null && Number.isFinite(normalizedCost)
      ? normalizedCost
      : null;
    const totalIncrement = lastCreditCost ?? 0;
    const row = await db.one(`
      INSERT INTO provider_usage (
        provider, request_count, total_credit_cost, last_credit_cost, last_used_at,
        last_error_code, last_error_message, last_error_at, updated_at
      )
      VALUES ($1, 1, $2, $3, NOW(), NULL, NULL, NULL, NOW())
      ON CONFLICT (provider) DO UPDATE SET
        request_count = provider_usage.request_count + 1,
        total_credit_cost = provider_usage.total_credit_cost + EXCLUDED.total_credit_cost,
        last_credit_cost = EXCLUDED.last_credit_cost,
        last_used_at = NOW(),
        last_error_code = NULL,
        last_error_message = NULL,
        last_error_at = NULL,
        updated_at = NOW()
      RETURNING *
    `, [provider, totalIncrement, lastCreditCost]);
    return normalizeProviderUsage(row);
  }

  async recordError(provider, code, message) {
    const row = await db.one(`
      INSERT INTO provider_usage (
        provider, request_count, total_credit_cost, last_error_code,
        last_error_message, last_error_at, updated_at
      )
      VALUES ($1, 0, 0, $2, $3, NOW(), NOW())
      ON CONFLICT (provider) DO UPDATE SET
        last_error_code = EXCLUDED.last_error_code,
        last_error_message = EXCLUDED.last_error_message,
        last_error_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [provider, code ? String(code) : null, message || null]);
    return normalizeProviderUsage(row);
  }
}

class AiConfigRepository {
  async create(config) {
    const row = await db.one(`
      INSERT INTO ai_configs (name, api_url, api_key, model, is_reasoning, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      config.name,
      config.api_url,
      config.api_key,
      config.model,
      config.is_reasoning ?? false,
      config.is_active ?? false
    ]);
    return row.id;
  }

  async update(id, updates) {
    const allowed = ['name', 'api_url', 'api_key', 'model', 'is_reasoning', 'is_active'];
    const { fields, values } = buildUpdate(updates, allowed);
    if (fields.length === 0) return false;
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await db.query(`UPDATE ai_configs SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    return result.rowCount > 0;
  }

  async findById(id) {
    return db.one('SELECT * FROM ai_configs WHERE id = $1', [id]);
  }

  async findActive() {
    return db.one('SELECT * FROM ai_configs WHERE is_active = TRUE LIMIT 1');
  }

  async findAll() {
    return db.many('SELECT * FROM ai_configs ORDER BY is_active DESC, updated_at DESC, id DESC');
  }

  async delete(id) {
    const result = await db.query('DELETE FROM ai_configs WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async setActive(id) {
    await db.transaction(async (tx) => {
      await tx.query('UPDATE ai_configs SET is_active = FALSE');
      await tx.query('UPDATE ai_configs SET is_active = TRUE WHERE id = $1', [id]);
    });
    return true;
  }
}

class TtsConfigRepository {
  async create(config) {
    return db.transaction(async (tx) => {
      const isActive = Boolean(config.is_active);
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('tts-config'))");
      if (isActive) {
        await tx.query(`
          UPDATE tts_configs
          SET is_active = FALSE, updated_at = NOW()
          WHERE provider = $1 AND is_active = TRUE
        `, [config.provider]);
      }

      const row = await tx.one(`
        INSERT INTO tts_configs (name, provider, api_url, api_key, model, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        config.name,
        config.provider,
        config.api_url || null,
        config.api_key || null,
        config.model || null,
        isActive
      ]);
      return row.id;
    });
  }

  async update(id, updates) {
    const allowed = ['name', 'provider', 'api_url', 'api_key', 'model', 'is_active'];
    if (!allowed.some((key) => updates[key] !== undefined)) return false;

    return db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('tts-config'))");
      const current = await tx.one('SELECT * FROM tts_configs WHERE id = $1 FOR UPDATE', [id]);
      if (!current) return false;

      const targetProvider = updates.provider ?? current.provider;
      const targetActive = updates.is_active === undefined
        ? Boolean(current.is_active)
        : Boolean(updates.is_active);
      if (targetActive) {
        await tx.query(`
          UPDATE tts_configs
          SET is_active = FALSE, updated_at = NOW()
          WHERE provider = $1 AND id <> $2 AND is_active = TRUE
        `, [targetProvider, id]);
      }

      const normalizedUpdates = {
        ...updates,
        is_active: targetActive
      };
      const { fields, values } = buildUpdate(normalizedUpdates, allowed);
      fields.push('updated_at = NOW()');
      values.push(id);
      const result = await tx.query(
        `UPDATE tts_configs SET ${fields.join(', ')} WHERE id = $${values.length}`,
        values
      );
      return result.rowCount > 0;
    });
  }

  async findById(id) {
    return db.one('SELECT * FROM tts_configs WHERE id = $1', [id]);
  }

  async findActiveByProvider(provider) {
    return db.one('SELECT * FROM tts_configs WHERE provider = $1 AND is_active = TRUE LIMIT 1', [provider]);
  }

  async findAll() {
    return db.many('SELECT * FROM tts_configs ORDER BY provider ASC, is_active DESC, updated_at DESC, id DESC');
  }

  async findByProvider(provider) {
    return db.many('SELECT * FROM tts_configs WHERE provider = $1 ORDER BY is_active DESC, updated_at DESC, id DESC', [provider]);
  }

  async delete(id) {
    const result = await db.query('DELETE FROM tts_configs WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async setActive(id) {
    return db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('tts-config'))");
      const config = await tx.one('SELECT * FROM tts_configs WHERE id = $1 FOR UPDATE', [id]);
      if (!config) return false;

      await tx.query(`
        UPDATE tts_configs
        SET is_active = FALSE, updated_at = NOW()
        WHERE provider = $1 AND id <> $2 AND is_active = TRUE
      `, [config.provider, id]);
      await tx.query(`
        UPDATE tts_configs
        SET is_active = TRUE, updated_at = NOW()
        WHERE id = $1
      `, [id]);
      return true;
    });
  }
}

module.exports = {
  BookCharacterRepository,
  BookRepository,
  ChapterAudioExportRepository,
  ChapterAudioSkipRangeRepository,
  ChapterCharacterRepository,
  ChapterRepository,
  ChapterSegmentRepository,
  CharacterVoiceBindingRepository,
  DialogueRepository,
  JobRepository,
  ProviderVoiceRepository,
  StorageObjectRepository,
  VoiceFavoriteRepository,
  VoiceProfileRepository,
  SystemSettingRepository,
  ProviderUsageRepository,
  AiConfigRepository,
  TtsConfigRepository,
  buildFavoriteKey
};

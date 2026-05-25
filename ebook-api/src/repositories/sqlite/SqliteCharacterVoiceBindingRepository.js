const dbInstance = require('./database');

class SqliteCharacterVoiceBindingRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  /**
   * 绑定或更新音色（UPSERT）
   */
  upsert(bookId, characterName, voiceIdOrBinding, voiceSource = 'system') {
    const binding = typeof voiceIdOrBinding === 'object'
      ? voiceIdOrBinding
      : { voice_id: voiceIdOrBinding, voice_source: voiceSource };
    const voiceId = binding.voice_id || binding.provider_voice_id;
    const source = binding.voice_source || voiceSource || 'system';
    const provider = binding.provider || 'mosi';
    const providerVoiceId = binding.provider_voice_id || (
      voiceId && !String(voiceId).startsWith('profile:') ? voiceId : null
    );
    const voiceProfileId = binding.voice_profile_id || null;
    const ttsModel = binding.tts_model || null;
    const intentDefaults = binding.intent_defaults
      ? (typeof binding.intent_defaults === 'string'
        ? binding.intent_defaults
        : JSON.stringify(binding.intent_defaults))
      : null;

    this.db.prepare(`
      INSERT INTO character_voice_bindings (
        book_id,
        character_name,
        voice_id,
        voice_source,
        provider,
        provider_voice_id,
        voice_profile_id,
        tts_model,
        intent_defaults
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, character_name) DO UPDATE SET
        voice_id          = excluded.voice_id,
        voice_source      = excluded.voice_source,
        provider          = excluded.provider,
        provider_voice_id = excluded.provider_voice_id,
        voice_profile_id  = excluded.voice_profile_id,
        tts_model         = excluded.tts_model,
        intent_defaults   = excluded.intent_defaults,
        updated_at        = CURRENT_TIMESTAMP
    `).run(
      bookId,
      characterName,
      voiceId,
      source,
      provider,
      providerVoiceId,
      voiceProfileId,
      ttsModel,
      intentDefaults
    );
  }

  /**
   * 查询一本书的所有绑定
   */
  findByBookId(bookId) {
    return this.db.prepare(
      'SELECT * FROM character_voice_bindings WHERE book_id = ? ORDER BY character_name ASC'
    ).all(bookId);
  }

  /**
   * 查询单个角色的绑定
   */
  findOne(bookId, characterName) {
    return this.db.prepare(
      'SELECT * FROM character_voice_bindings WHERE book_id = ? AND character_name = ?'
    ).get(bookId, characterName);
  }

  /**
   * 解绑
   */
  delete(bookId, characterName) {
    const info = this.db.prepare(
      'DELETE FROM character_voice_bindings WHERE book_id = ? AND character_name = ?'
    ).run(bookId, characterName);
    return info.changes > 0;
  }
}

module.exports = SqliteCharacterVoiceBindingRepository;

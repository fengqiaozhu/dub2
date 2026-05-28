const dbInstance = require('./database');

class SqliteProviderVoiceRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  upsert(voice) {
    this.db.prepare(`
      INSERT INTO provider_voices (
        voice_profile_id,
        provider,
        provider_voice_id,
        provider_model,
        kind,
        status,
        capabilities_snapshot,
        provider_meta
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_voice_id) DO UPDATE SET
        voice_profile_id       = excluded.voice_profile_id,
        provider_model         = excluded.provider_model,
        kind                   = excluded.kind,
        status                 = excluded.status,
        capabilities_snapshot  = excluded.capabilities_snapshot,
        provider_meta          = excluded.provider_meta,
        updated_at             = CURRENT_TIMESTAMP
    `).run(
      voice.voice_profile_id || null,
      voice.provider,
      voice.provider_voice_id,
      voice.provider_model || null,
      voice.kind || 'clone',
      voice.status || null,
      voice.capabilities_snapshot ? JSON.stringify(voice.capabilities_snapshot) : null,
      voice.provider_meta ? JSON.stringify(voice.provider_meta) : null
    );
  }

  findByProviderVoiceId(provider, providerVoiceId) {
    return this.db.prepare(`
      SELECT
        pv.*,
        vp.name AS voice_profile_name,
        vp.sample_audio_url,
        vp.sample_text,
        vp.language AS profile_language,
        vp.consent_status
      FROM provider_voices pv
      LEFT JOIN voice_profiles vp ON vp.id = pv.voice_profile_id
      WHERE pv.provider = ? AND pv.provider_voice_id = ?
    `).get(provider, providerVoiceId);
  }

  findByProfileId(voiceProfileId) {
    return this.db.prepare(
      'SELECT * FROM provider_voices WHERE voice_profile_id = ?'
    ).all(voiceProfileId);
  }

  deleteMissingForProvider(provider, confirmedVoiceIds = []) {
    const ids = confirmedVoiceIds.filter(Boolean);
    if (ids.length === 0) {
      return this.db.prepare(`
        DELETE FROM provider_voices
        WHERE provider = ? AND kind IN ('clone', 'custom', 'imported')
      `).run(provider).changes;
    }

    const placeholders = ids.map(() => '?').join(', ');
    return this.db.prepare(`
      DELETE FROM provider_voices
      WHERE provider = ?
        AND kind IN ('clone', 'custom', 'imported')
        AND provider_voice_id NOT IN (${placeholders})
    `).run(provider, ...ids).changes;
  }

  findActiveByProfileId(voiceProfileId, provider) {
    const conditions = ['voice_profile_id = ?'];
    const values = [voiceProfileId];

    if (provider) {
      conditions.push('provider = ?');
      values.push(provider);
    }

    return this.db.prepare(`
      SELECT *
      FROM provider_voices
      WHERE ${conditions.join(' AND ')}
        AND UPPER(COALESCE(status, 'ACTIVE')) IN ('ACTIVE', 'DONE')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `).get(...values);
  }

  findAll({ provider, kind, status, limit = 100, offset = 0 } = {}) {
    const conditions = [];
    const values = [];

    if (provider) {
      conditions.push('pv.provider = ?');
      values.push(provider);
    }
    if (kind) {
      conditions.push('pv.kind = ?');
      values.push(kind);
    }
    if (status) {
      conditions.push('pv.status = ?');
      values.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit, offset);

    return this.db.prepare(`
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
      LIMIT ? OFFSET ?
    `).all(...values);
  }
}

module.exports = SqliteProviderVoiceRepository;

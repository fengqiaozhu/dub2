const dbInstance = require('./database');

class SqliteVoiceProfileRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  create(profile) {
    const info = this.db.prepare(`
      INSERT INTO voice_profiles (
        name,
        description,
        sample_text,
        sample_audio_url,
        language,
        speaker_meta,
        consent_status,
        quality_meta
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.name,
      profile.description || null,
      profile.sample_text || null,
      profile.sample_audio_url || null,
      profile.language || null,
      profile.speaker_meta ? JSON.stringify(profile.speaker_meta) : null,
      profile.consent_status || 'unknown',
      profile.quality_meta ? JSON.stringify(profile.quality_meta) : null
    );

    return info.lastInsertRowid;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM voice_profiles WHERE id = ?').get(id);
  }

  findAll({ limit = 100, offset = 0, search } = {}) {
    const values = [];
    let where = '';

    if (search) {
      where = `WHERE name LIKE ? OR sample_text LIKE ? OR language LIKE ?`;
      const q = `%${search}%`;
      values.push(q, q, q);
    }

    values.push(limit, offset);
    return this.db.prepare(`
      SELECT
        vp.*,
        COUNT(pv.id) AS provider_voice_count,
        GROUP_CONCAT(pv.provider || ':' || COALESCE(pv.status, 'unknown')) AS provider_statuses
      FROM voice_profiles vp
      LEFT JOIN provider_voices pv ON pv.voice_profile_id = vp.id
      ${where}
      GROUP BY vp.id
      ORDER BY vp.updated_at DESC, vp.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...values);
  }
}

module.exports = SqliteVoiceProfileRepository;

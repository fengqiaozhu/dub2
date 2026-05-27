const dbInstance = require('./database');

function buildFavoriteKey({ provider, provider_voice_id, voice_profile_id, voice_source }) {
  if (provider_voice_id) return `${provider || 'mosi'}:${voice_source || 'clone'}:${provider_voice_id}`;
  if (voice_profile_id === undefined || voice_profile_id === null) return '';
  return `profile:${voice_profile_id}`;
}

class SqliteVoiceFavoriteRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  findAll() {
    return this.db.prepare(`
      SELECT *
      FROM voice_favorites
      ORDER BY created_at DESC
    `).all();
  }

  upsert(favorite) {
    const favoriteKey = buildFavoriteKey(favorite);
    this.db.prepare(`
      INSERT INTO voice_favorites (
        favorite_key,
        provider,
        provider_voice_id,
        voice_source,
        voice_profile_id,
        name_snapshot
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(favorite_key) DO UPDATE SET
        provider          = excluded.provider,
        provider_voice_id = excluded.provider_voice_id,
        voice_source      = excluded.voice_source,
        voice_profile_id  = excluded.voice_profile_id,
        name_snapshot     = excluded.name_snapshot,
        updated_at        = CURRENT_TIMESTAMP
    `).run(
      favoriteKey,
      favorite.provider || null,
      favorite.provider_voice_id || null,
      favorite.voice_source || 'clone',
      favorite.voice_profile_id || null,
      favorite.name_snapshot || null
    );

    return this.findByKey(favoriteKey);
  }

  findByKey(favoriteKey) {
    return this.db.prepare(
      'SELECT * FROM voice_favorites WHERE favorite_key = ?'
    ).get(favoriteKey);
  }

  delete(favorite) {
    const favoriteKey = buildFavoriteKey(favorite);
    const info = this.db.prepare(
      'DELETE FROM voice_favorites WHERE favorite_key = ?'
    ).run(favoriteKey);
    return info.changes > 0;
  }
}

SqliteVoiceFavoriteRepository.buildFavoriteKey = buildFavoriteKey;

module.exports = SqliteVoiceFavoriteRepository;

const dbInstance = require('./database');

class SqliteChapterAudioExportRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  findLatestByChapterId(chapterId) {
    return this.db.prepare(`
      SELECT *
      FROM chapter_audio_exports
      WHERE chapter_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(chapterId);
  }

  create(exportRecord) {
    const info = this.db.prepare(`
      INSERT INTO chapter_audio_exports (chapter_id, audio_url, format, source_hash, item_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      exportRecord.chapter_id,
      exportRecord.audio_url,
      exportRecord.format || 'wav',
      exportRecord.source_hash,
      exportRecord.item_count || 0
    );
    return info.lastInsertRowid;
  }

  deleteByChapterId(chapterId) {
    const info = this.db.prepare('DELETE FROM chapter_audio_exports WHERE chapter_id = ?').run(chapterId);
    return info.changes;
  }
}

module.exports = SqliteChapterAudioExportRepository;

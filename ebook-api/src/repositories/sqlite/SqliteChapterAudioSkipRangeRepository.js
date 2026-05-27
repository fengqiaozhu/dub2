const dbInstance = require('./database');

class SqliteChapterAudioSkipRangeRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  findByChapterId(chapterId) {
    return this.db.prepare(`
      SELECT *
      FROM chapter_audio_skip_ranges
      WHERE chapter_id = ?
      ORDER BY char_start ASC, char_end ASC, id ASC
    `).all(chapterId);
  }

  upsert(chapterId, charStart, charEnd) {
    const info = this.db.prepare(`
      INSERT INTO chapter_audio_skip_ranges (chapter_id, char_start, char_end)
      VALUES (?, ?, ?)
      ON CONFLICT(chapter_id, char_start, char_end)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).run(chapterId, charStart, charEnd);
    return info.lastInsertRowid;
  }

  deleteRange(chapterId, charStart, charEnd) {
    const info = this.db.prepare(`
      DELETE FROM chapter_audio_skip_ranges
      WHERE chapter_id = ? AND char_start = ? AND char_end = ?
    `).run(chapterId, charStart, charEnd);
    return info.changes;
  }

  deleteByChapterId(chapterId) {
    const info = this.db.prepare(`
      DELETE FROM chapter_audio_skip_ranges
      WHERE chapter_id = ?
    `).run(chapterId);
    return info.changes;
  }
}

module.exports = SqliteChapterAudioSkipRangeRepository;

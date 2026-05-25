const dbInstance = require('./database');

class SqliteChapterSegmentRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  createMany(chapterId, segments) {
    const stmt = this.db.prepare(`
      INSERT INTO chapter_segments (chapter_id, content, segment_index, char_start, char_end, segment_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((items) => {
      for (const segment of items) {
        stmt.run(
          chapterId,
          segment.content,
          segment.segment_index,
          segment.char_start,
          segment.char_end,
          segment.segment_type || 'unknown'
        );
      }
    });
    insertMany(segments);
  }

  replaceForChapter(chapterId, segments) {
    const stmt = this.db.prepare(`
      INSERT INTO chapter_segments (chapter_id, content, segment_index, char_start, char_end, segment_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const replace = this.db.transaction((items) => {
      this.db.prepare('DELETE FROM chapter_segments WHERE chapter_id = ?').run(chapterId);
      for (const segment of items) {
        stmt.run(
          chapterId,
          segment.content,
          segment.segment_index,
          segment.char_start,
          segment.char_end,
          segment.segment_type || 'unknown'
        );
      }
    });
    replace(segments);
  }

  findByChapterId(chapterId) {
    return this.db.prepare(`
      SELECT *
      FROM chapter_segments
      WHERE chapter_id = ?
      ORDER BY segment_index ASC, id ASC
    `).all(chapterId);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM chapter_segments WHERE id = ?').get(id);
  }

  updateType(id, segmentType) {
    const info = this.db.prepare(`
      UPDATE chapter_segments
      SET segment_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(segmentType, id);
    return info.changes > 0;
  }

  deleteByChapterId(chapterId) {
    return this.db.prepare('DELETE FROM chapter_segments WHERE chapter_id = ?').run(chapterId);
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

module.exports = SqliteChapterSegmentRepository;

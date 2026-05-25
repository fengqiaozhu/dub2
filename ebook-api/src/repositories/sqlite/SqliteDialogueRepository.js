const dbInstance = require('./database');

class SqliteDialogueRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  /**
   * 批量插入对白（事务）
   * @param {Array} dialogues - [{chapter_character_id, segment_id, chapter_id, content, char_start, char_end, source, annotation_status, order_index}]
   */
  createMany(dialogues) {
    const stmt = this.db.prepare(`
      INSERT INTO dialogues (chapter_character_id, segment_id, chapter_id, content, emotion, char_start, char_end, source, annotation_status, updated_by, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((items) => {
      for (const d of items) {
        stmt.run(
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
        );
      }
    });
    insertMany(dialogues);
  }

  /**
   * 新增单条对白（手动添加）
   */
  create(dialogue) {
    const stmt = this.db.prepare(`
      INSERT INTO dialogues (chapter_character_id, segment_id, chapter_id, content, emotion, char_start, char_end, source, annotation_status, updated_by, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
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
    );
    return info.lastInsertRowid;
  }

  /**
   * 查询某章节角色的所有对白，按 order_index 升序
   */
  findByChapterCharacterId(chapterCharacterId) {
    return this.db.prepare(`
      SELECT d.*
      FROM dialogues d
      WHERE d.chapter_character_id = ?
      ORDER BY d.char_start ASC, d.order_index ASC, d.id ASC
    `).all(chapterCharacterId);
  }

  /**
   * 查询某章节的所有对白（跨角色），附角色名
   */
  findByChapterId(chapterId) {
    return this.db.prepare(`
      SELECT d.*, cc.character_name
      FROM dialogues d
      JOIN chapter_characters cc ON cc.id = d.chapter_character_id
      WHERE d.chapter_id = ?
      ORDER BY d.char_start ASC, d.order_index ASC, d.id ASC
    `).all(chapterId);
  }

  clearAudioByChapterId(chapterId) {
    const info = this.db.prepare(`
      UPDATE dialogues
      SET audio_url = NULL,
          audio_duration = NULL,
          audio_source_hash = NULL,
          audio_error = NULL,
          audio_status = 'missing',
          updated_at = CURRENT_TIMESTAMP
      WHERE chapter_id = ?
    `).run(chapterId);
    return info.changes;
  }

  clearAudioById(id) {
    const info = this.db.prepare(`
      UPDATE dialogues
      SET audio_url = NULL,
          audio_duration = NULL,
          audio_source_hash = NULL,
          audio_error = NULL,
          audio_status = 'missing',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
    return info.changes > 0;
  }

  findById(id) {
    return this.db.prepare(`
      SELECT d.*, cc.character_name, cc.book_id
      FROM dialogues d
      JOIN chapter_characters cc ON cc.id = d.chapter_character_id
      WHERE d.id = ?
    `).get(id);
  }

  findBySegmentId(segmentId) {
    return this.db.prepare(`
      SELECT d.*, cc.character_name
      FROM dialogues d
      JOIN chapter_characters cc ON cc.id = d.chapter_character_id
      WHERE d.segment_id = ?
      ORDER BY d.id ASC
      LIMIT 1
    `).get(segmentId);
  }

  /**
   * 更新对白内容
   */
  update(id, updates) {
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
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    }
    if (fields.length === 0) return false;

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);
    const info = this.db.prepare(
      `UPDATE dialogues SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
    return info.changes > 0;
  }

  delete(id) {
    const info = this.db.prepare('DELETE FROM dialogues WHERE id = ?').run(id);
    return info.changes > 0;
  }

  deleteByChapterIdAndSource(chapterId, source) {
    const info = this.db.prepare('DELETE FROM dialogues WHERE chapter_id = ? AND source = ?').run(chapterId, source);
    return info.changes;
  }

  deleteByChapterId(chapterId) {
    const info = this.db.prepare('DELETE FROM dialogues WHERE chapter_id = ?').run(chapterId);
    return info.changes;
  }

  deleteBySegmentId(segmentId) {
    const info = this.db.prepare('DELETE FROM dialogues WHERE segment_id = ?').run(segmentId);
    return info.changes;
  }
}

module.exports = SqliteDialogueRepository;

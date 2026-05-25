const dbInstance = require('./database');

class SqliteBookCharacterRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  /**
   * UPSERT 角色汇总
   * 新角色插入，已存在则累加 dialogue_count 和 chapter_count
   */
  upsert(bookId, characterName, dialogueCountDelta, chapterCountDelta) {
    this.db.prepare(`
      INSERT INTO book_characters (book_id, character_name, dialogue_count, chapter_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(book_id, character_name) DO UPDATE SET
        dialogue_count = dialogue_count + excluded.dialogue_count,
        chapter_count  = chapter_count  + excluded.chapter_count
    `).run(bookId, characterName, dialogueCountDelta, chapterCountDelta);
  }

  /**
   * 重置章节对应角色的统计（重新分析某章节时调用）
   * 先从 dialogues 表重新聚合，防止重复计数
   */
  recalculateForBook(bookId) {
    this.db.prepare('DELETE FROM book_characters WHERE book_id = ?').run(bookId);
    this.db.prepare(`
      INSERT INTO book_characters (book_id, character_name, dialogue_count, chapter_count)
      SELECT
        cc.book_id,
        cc.character_name,
        COUNT(d.id)            AS dialogue_count,
        COUNT(DISTINCT cc.chapter_id) AS chapter_count
      FROM chapter_characters cc
      JOIN dialogues d ON d.chapter_character_id = cc.id
      WHERE cc.book_id = ?
      GROUP BY cc.book_id, cc.character_name
    `).run(bookId);
  }

  /**
   * 查询全书角色列表，附带音色绑定信息
   */
  findByBookId(bookId) {
    return this.db.prepare(`
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
      WHERE bc.book_id = ?
      ORDER BY bc.dialogue_count DESC
    `).all(bookId);
  }
}

module.exports = SqliteBookCharacterRepository;

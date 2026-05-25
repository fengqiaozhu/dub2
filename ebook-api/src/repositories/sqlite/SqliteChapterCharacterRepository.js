const dbInstance = require('./database');

class SqliteChapterCharacterRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  /**
   * 插入一个章节角色，如已存在则忽略（UNIQUE约束）
   * @returns {number} lastInsertRowid 或已存在的 id
   */
  upsert(chapterId, bookId, characterName) {
    const insert = this.db.prepare(`
      INSERT INTO chapter_characters (chapter_id, book_id, character_name)
      VALUES (?, ?, ?)
      ON CONFLICT(chapter_id, character_name) DO UPDATE SET character_name = character_name
    `);
    insert.run(chapterId, bookId, characterName);

    // 返回实际 id（不管是新插入还是已存在）
    const row = this.db.prepare(
      'SELECT id FROM chapter_characters WHERE chapter_id = ? AND character_name = ?'
    ).get(chapterId, characterName);
    return row.id;
  }

  /**
   * 查询某章节的所有角色，附带对白数统计
   */
  findByChapterId(chapterId) {
    return this.db.prepare(`
      SELECT cc.*, COUNT(d.id) AS dialogue_count
      FROM chapter_characters cc
      LEFT JOIN dialogues d ON d.chapter_character_id = cc.id
      WHERE cc.chapter_id = ?
      GROUP BY cc.id
      ORDER BY cc.id ASC
    `).all(chapterId);
  }

  /**
   * 删除某章节的所有角色（重新分析前清理旧数据）
   * 级联会自动删除关联的 dialogues
   */
  deleteByChapterId(chapterId) {
    return this.db.prepare(
      'DELETE FROM chapter_characters WHERE chapter_id = ?'
    ).run(chapterId);
  }

  deleteUnusedByChapterId(chapterId) {
    return this.db.prepare(`
      DELETE FROM chapter_characters
      WHERE chapter_id = ?
        AND id NOT IN (
          SELECT DISTINCT chapter_character_id
          FROM dialogues
          WHERE chapter_id = ?
        )
    `).run(chapterId, chapterId);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM chapter_characters WHERE id = ?').get(id);
  }
}

module.exports = SqliteChapterCharacterRepository;

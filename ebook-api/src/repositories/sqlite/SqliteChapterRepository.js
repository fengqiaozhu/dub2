const dbInstance = require('./database');

class SqliteChapterRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  create(chapter) {
    const stmt = this.db.prepare(`
      INSERT INTO chapters (book_id, title, content, chapter_index) 
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(chapter.book_id, chapter.title, chapter.content, chapter.chapter_index);
    return info.lastInsertRowid;
  }

  createMany(chapters) {
    const stmt = this.db.prepare(`
      INSERT INTO chapters (book_id, title, content, chapter_index) 
      VALUES (?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((chaptersArray) => {
      for (const chapter of chaptersArray) {
        stmt.run(chapter.book_id, chapter.title, chapter.content, chapter.chapter_index);
      }
    });
    
    insertMany(chapters);
  }

  findByBookId(bookId) {
    // Only return metadata, not full content for list
    const stmt = this.db.prepare('SELECT id, book_id, title, chapter_index, created_at, ai_analysis FROM chapters WHERE book_id = ? ORDER BY chapter_index ASC');
    return stmt.all(bookId);
  }

  getNextChapterIndex(bookId) {
    const row = this.db.prepare('SELECT COALESCE(MAX(chapter_index), -1) + 1 AS next_index FROM chapters WHERE book_id = ?').get(bookId);
    return row.next_index;
  }

  findById(id) {
    const stmt = this.db.prepare('SELECT * FROM chapters WHERE id = ?');
    return stmt.get(id);
  }

  update(id, updates) {
    const allowed = ['title', 'content', 'chapter_index', 'ai_analysis'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    }
    
    if (fields.length === 0) return false;
    
    values.push(id);
    const stmt = this.db.prepare(`UPDATE chapters SET ${fields.join(', ')} WHERE id = ?`);
    const info = stmt.run(...values);
    return info.changes > 0;
  }

  delete(id) {
    const stmt = this.db.prepare('DELETE FROM chapters WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  }
}

module.exports = SqliteChapterRepository;

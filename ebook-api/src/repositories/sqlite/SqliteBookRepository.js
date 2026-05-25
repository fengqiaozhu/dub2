const dbInstance = require('./database');

class SqliteBookRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  create(book) {
    const fields = ['title', 'format'];
    const values = [book.title, book.format];
    const optional = ['author', 'description', 'language', 'tags', 'cover_url', 'status', 'publisher', 'publish_year', 'isbn'];

    for (const key of optional) {
      if (book[key] !== undefined && book[key] !== null) {
        fields.push(key);
        values.push(book[key]);
      }
    }

    const placeholders = fields.map(() => '?').join(', ');
    const stmt = this.db.prepare(`INSERT INTO books (${fields.join(', ')}) VALUES (${placeholders})`);
    const info = stmt.run(...values);
    return info.lastInsertRowid;
  }

  update(id, updates) {
    const allowed = ['title', 'format', 'author', 'description', 'language', 'tags', 'cover_url', 'status', 'publisher', 'publish_year', 'isbn'];
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
    const stmt = this.db.prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`);
    const info = stmt.run(...values);
    return info.changes > 0;
  }

  findById(id) {
    const stmt = this.db.prepare('SELECT * FROM books WHERE id = ?');
    return stmt.get(id);
  }

  findAll(options = {}) {
    const { q, sort, order } = options;

    let sql = `
      SELECT b.*, COUNT(c.id) AS chapter_count
      FROM books b
      LEFT JOIN chapters c ON c.book_id = b.id
    `;

    const params = [];

    if (q) {
      sql += ` WHERE (b.title LIKE ? OR b.author LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }

    sql += ` GROUP BY b.id`;

    // Sort validation
    const allowedSorts = ['title', 'created_at', 'author'];
    const sortCol = allowedSorts.includes(sort) ? `b.${sort}` : 'b.created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  count() {
    const stmt = this.db.prepare('SELECT COUNT(*) AS total FROM books');
    const result = stmt.get();
    return result.total;
  }

  delete(id) {
    const stmt = this.db.prepare('DELETE FROM books WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  }
}

module.exports = SqliteBookRepository;

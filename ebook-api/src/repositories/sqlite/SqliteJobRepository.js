const dbInstance = require('./database');

class SqliteJobRepository {
  constructor() {
    this.db = dbInstance.getDb();
  }

  create(job) {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, job_name, type, target_id, status, progress, result, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.job_name,
      job.type,
      job.target_id || null,
      job.status || 'PENDING',
      job.progress || 0,
      job.result ? JSON.stringify(job.result) : null,
      job.error || null
    );
    return this.findById(job.id);
  }

  findById(id) {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const job = stmt.get(id);
    if (job) {
      if (job.result) {
        try {
          job.result = JSON.parse(job.result);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    }
    return job;
  }

  findActiveByTypeAndTarget(type, targetId) {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE type = ?
        AND target_id = ?
        AND status IN ('PENDING', 'RUNNING')
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(type, targetId);
  }

  update(id, data) {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(data)) {
      if (['status', 'progress', 'result', 'error'].includes(key)) {
        fields.push(`${key} = ?`);
        if (key === 'result' && typeof value === 'object') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  findAll(filters = {}) {
    let query = 'SELECT * FROM jobs';
    const conditions = [];
    const values = [];

    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }

    if (filters.target_id) {
      conditions.push('target_id = ?');
      values.push(filters.target_id);
    }

    if (filters.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ? OFFSET ?';
      values.push(filters.limit || 50, filters.offset || 0);
    }

    const stmt = this.db.prepare(query);
    const jobs = stmt.all(...values);
    
    return jobs.map(job => {
      if (job.result) {
        try {
          job.result = JSON.parse(job.result);
        } catch (e) { }
      }
      return job;
    });
  }

  /**
   * 将系统意外重启时遗留的未完成任务标记为失败
   */
  markStaleJobsAsFailed() {
    const stmt = this.db.prepare(`
      UPDATE jobs 
      SET status = 'FAILED', 
          error = 'Server restarted before job completed',
          updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('PENDING', 'RUNNING')
    `);
    const info = stmt.run();
    return info.changes;
  }

  /**
   * 清理过期（如 7 天前）的已完成或失败任务以防止数据库膨胀
   * @param {number} daysToKeep 
   */
  cleanupOldJobs(daysToKeep = 7) {
    const stmt = this.db.prepare(`
      DELETE FROM jobs 
      WHERE status IN ('DONE', 'FAILED') 
        AND created_at < datetime('now', '-' || ? || ' days')
    `);
    const info = stmt.run(daysToKeep);
    return info.changes;
  }
}

module.exports = new SqliteJobRepository();

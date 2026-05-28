const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgres://ebook:ebook@localhost:5432/ebook';

const pool = new Pool({
  connectionString: databaseUrl,
});

function normalizeRows(rows) {
  return rows.map((row) => {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') row[key] = Number(value);
    }
    return row;
  });
}

async function query(text, params = []) {
  const result = await pool.query(text, params);
  result.rows = normalizeRows(result.rows);
  return result;
}

async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: async (text, params = []) => {
        const result = await client.query(text, params);
        result.rows = normalizeRows(result.rows);
        return result;
      },
      one: async (text, params = []) => {
        const result = await client.query(text, params);
        result.rows = normalizeRows(result.rows);
        return result.rows[0] || null;
      },
      many: async (text, params = []) => {
        const result = await client.query(text, params);
        result.rows = normalizeRows(result.rows);
        return result.rows;
      }
    };
    const value = await callback(tx);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

async function ping() {
  await query('SELECT 1');
  return true;
}

module.exports = {
  close,
  many,
  one,
  ping,
  pool,
  query,
  transaction
};

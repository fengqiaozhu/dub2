require('dotenv').config();

const { initSchema } = require('../src/repositories/postgres/schema');
const db = require('../src/repositories/postgres/db');

(async () => {
  try {
    await initSchema();
    console.log('PostgreSQL schema initialized.');
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

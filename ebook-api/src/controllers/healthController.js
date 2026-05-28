const db = require('../repositories/postgres/db');
const storageService = require('../services/storage/storageService');

class HealthController {
  async getHealth(req, res) {
    const checks = {
      api: { ok: true },
      postgres: { ok: false },
      s3: { ok: false }
    };

    try {
      await db.ping();
      checks.postgres.ok = true;
    } catch (error) {
      checks.postgres.error = error.message;
    }

    try {
      await storageService.ping();
      checks.s3.ok = true;
      checks.s3.bucket = storageService.bucket;
    } catch (error) {
      checks.s3.error = error.message;
    }

    const ok = Object.values(checks).every((check) => check.ok);
    res.status(ok ? 200 : 503).json({
      data: {
        ok,
        checks
      }
    });
  }
}

module.exports = new HealthController();

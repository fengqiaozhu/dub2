const crypto = require('crypto');

const HEALTH_PATH = '/api/health';

function resolveAuthConfig(env) {
  const token = (env.DUB_ACCESS_TOKEN || '').trim();
  const mode = (env.DUB_AUTH_MODE || '').trim();

  if (token) {
    return { enabled: true, token };
  }

  if (mode === 'disabled') {
    return { enabled: false, token: '' };
  }

  throw new Error(
    'DUB_ACCESS_TOKEN is not set. Set DUB_ACCESS_TOKEN to enable authentication, '
    + 'or set DUB_AUTH_MODE=disabled explicitly to run without authentication.'
  );
}

function extractBearerToken(header) {
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : '';
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing independent of length mismatch.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createAuthMiddleware(authConfig) {
  return function authMiddleware(req, res, next) {
    if (!authConfig || !authConfig.enabled) {
      next();
      return;
    }

    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (req.method === 'GET' && (req.path === HEALTH_PATH || req.path === `${HEALTH_PATH}/`)) {
      next();
      return;
    }

    const headerToken = extractBearerToken(req.headers.authorization);
    const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : '';

    if (!safeEqual(headerToken || queryToken, authConfig.token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    next();
  };
}

module.exports = {
  HEALTH_PATH,
  createAuthMiddleware,
  extractBearerToken,
  resolveAuthConfig,
  safeEqual
};

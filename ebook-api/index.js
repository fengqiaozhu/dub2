require('dotenv').config();
const { createApp } = require('./src/app');
const { resolveAuthConfig } = require('./src/middleware/auth');
const { initSchema } = require('./src/repositories/postgres/schema');
const jobManager = require('./src/services/jobManager');

const port = process.env.PORT || 13000;

(async () => {
  let authConfig;
  try {
    authConfig = resolveAuthConfig(process.env);
    if (!authConfig.enabled) {
      console.warn('AUTHENTICATION IS DISABLED (DUB_AUTH_MODE=disabled). All /api/* and /media/* endpoints are open to anyone.');
    } else {
      console.log('Authentication enabled: /api/* and /media/* require a valid bearer token.');
    }
  } catch (err) {
    console.error('Refusing to start:', err.message);
    process.exit(1);
  }

  const app = createApp(authConfig);

  try {
    await initSchema();
    // Start Bree job manager
    await jobManager.start();

    app.listen(port, () => {
      console.log(`dub API server running at http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();

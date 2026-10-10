const express = require('express');
const cors = require('cors');
const { createAuthMiddleware } = require('./middleware/auth');

const bookRoutes = require('./routes/books');
const chapterRoutes = require('./routes/chapters');
const chapterCharacterRoutes = require('./routes/chapterCharacters');
const dialogueRoutes = require('./routes/dialogues');
const annotationRoutes = require('./routes/annotations');
const mosiRoutes = require('./routes/mosi');
const ttsRoutes = require('./routes/tts');
const jobRoutes = require('./routes/jobs');
const mediaRoutes = require('./routes/media');
const healthRoutes = require('./routes/health');
const settingRoutes = require('./routes/settings');
const chatRoutes = require('./routes/chat');

function createApp(authConfig) {
  const app = express();

  const corsOrigin = process.env.DUB_CORS_ORIGIN || 'http://localhost:13001';
  app.use(cors({
    origin: corsOrigin,
    maxAge: 86400
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use(createAuthMiddleware(authConfig));

  app.use('/media', mediaRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/books', bookRoutes);
  app.use('/api/chapters', chapterRoutes);
  app.use('/api/chapter-characters', chapterCharacterRoutes);
  app.use('/api/dialogues', dialogueRoutes);
  app.use('/api/annotations', annotationRoutes);
  app.use('/api/tts', ttsRoutes);
  app.use('/api/mosi', mosiRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/settings', settingRoutes);
  app.use('/api/chat', chatRoutes);

  return app;
}

module.exports = { createApp };

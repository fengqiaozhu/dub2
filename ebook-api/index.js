require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initSchema } = require('./src/repositories/postgres/schema');

const bookRoutes = require('./src/routes/books');
const chapterRoutes = require('./src/routes/chapters');
const chapterCharacterRoutes = require('./src/routes/chapterCharacters');
const dialogueRoutes = require('./src/routes/dialogues');
const annotationRoutes = require('./src/routes/annotations');
const mosiRoutes = require('./src/routes/mosi');
const ttsRoutes = require('./src/routes/tts');
const jobRoutes = require('./src/routes/jobs');
const mediaRoutes = require('./src/routes/media');
const healthRoutes = require('./src/routes/health');
const settingRoutes = require('./src/routes/settings');
const chatRoutes = require('./src/routes/chat');
const jobManager = require('./src/services/jobManager');
const path = require('path');

const app = express();
const port = process.env.PORT || 13000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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


(async () => {
  try {
    await initSchema();
    // Start Bree job manager
    await jobManager.start();
    
    app.listen(port, () => {
      console.log(`dub API server running at http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
})();

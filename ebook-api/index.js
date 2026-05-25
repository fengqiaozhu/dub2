require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Ensure database is initialized before starting
require('./src/repositories/sqlite/database');

const bookRoutes = require('./src/routes/books');
const chapterRoutes = require('./src/routes/chapters');
const chapterCharacterRoutes = require('./src/routes/chapterCharacters');
const dialogueRoutes = require('./src/routes/dialogues');
const annotationRoutes = require('./src/routes/annotations');
const mosiRoutes = require('./src/routes/mosi');
const ttsRoutes = require('./src/routes/tts');
const jobRoutes = require('./src/routes/jobs');
const jobManager = require('./src/services/jobManager');
const path = require('path');

const app = express();
const port = process.env.PORT || 13000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file hosting for generated audio
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/books', bookRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/chapter-characters', chapterCharacterRoutes);
app.use('/api/dialogues', dialogueRoutes);
app.use('/api/annotations', annotationRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/mosi', mosiRoutes);
app.use('/api/jobs', jobRoutes);


(async () => {
  try {
    // Start Bree job manager
    await jobManager.start();
    
    app.listen(port, () => {
      console.log(`Ebook API server running at http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
})();

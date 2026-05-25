const express = require('express');
const chapterController = require('../controllers/chapterController');
const characterController = require('../controllers/characterController');

const router = express.Router();

router.post('/', chapterController.createChapter);
router.get('/:id', chapterController.getChapter);
router.put('/:id', chapterController.updateChapter);
router.delete('/:id', chapterController.deleteChapter);

// AI Analysis
router.post('/:id/analyze', chapterController.analyzeChapter);
router.post('/:id/annotations', chapterController.createAnnotation);
router.put('/annotations/:id', chapterController.updateAnnotation);
router.delete('/annotations/:id', chapterController.deleteAnnotation);

// Characters & Dialogues
router.get('/:id/dubbing-preview', chapterController.dubbingPreview);
router.post('/:id/batch-dub', chapterController.batchDub);
router.get('/:id/export-audio', chapterController.exportAudioArchive);
router.post('/:id/export-audio/merged', chapterController.exportMergedAudio);
router.get('/:id/characters', characterController.getChapterCharacters);

module.exports = router;

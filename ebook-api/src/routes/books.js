const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const bookController = require('../controllers/bookController');
const characterController = require('../controllers/characterController');

const router = express.Router();

// Multer config for file upload
const upload = multer({ dest: path.join(os.tmpdir(), 'ebook-uploads') });

router.post('/upload', upload.single('file'), bookController.upload);
router.post('/', bookController.createBook);
router.get('/', bookController.getAllBooks);
router.get('/count', bookController.getBookCount);
router.get('/:id', bookController.getBookById);
router.put('/:id', bookController.updateBook);
router.post('/:id/cover', upload.single('cover'), bookController.uploadCover);
router.get('/:bookId/chapters', bookController.getChapters);
router.post('/:bookId/chapters', bookController.createChapterForBook);
router.delete('/:id', bookController.deleteBook);

// Characters (aggregated across all chapters)
router.get('/:id/characters', characterController.getBookCharacters);

// Voice Bindings
router.get('/:id/voice-bindings', characterController.getVoiceBindings);
router.get('/:id/voice-usage', characterController.getVoiceUsage);
router.put('/:bookId/voice-bindings/:character', characterController.upsertVoiceBinding);
router.delete('/:bookId/voice-bindings/:character', characterController.deleteVoiceBinding);

// Character profiles / aliases / pronunciation rules
router.get('/:id/character-profiles', characterController.getCharacterProfiles);
router.post('/:id/character-profiles/:profileId/aliases', characterController.addAlias);
router.delete('/:id/aliases/:aliasId', characterController.deleteAlias);
router.post('/:id/pronunciation-rules/preview-impact', characterController.previewPronunciationRuleImpact);
router.get('/:id/pronunciation-rules', characterController.getPronunciationRules);
router.post('/:id/pronunciation-rules', characterController.createPronunciationRule);
router.patch('/:id/pronunciation-rules/:ruleId', characterController.updatePronunciationRule);
router.delete('/:id/pronunciation-rules/:ruleId', characterController.deletePronunciationRule);
router.get('/:id/pronunciation-rules/:ruleId/impact', characterController.getPronunciationRuleImpact);

module.exports = router;

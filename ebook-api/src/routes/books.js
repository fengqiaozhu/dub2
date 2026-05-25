const express = require('express');
const multer = require('multer');
const bookController = require('../controllers/bookController');
const characterController = require('../controllers/characterController');

const router = express.Router();

// Multer config for file upload
const upload = multer({ dest: 'uploads/' });

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
router.put('/:bookId/voice-bindings/:character', characterController.upsertVoiceBinding);
router.delete('/:bookId/voice-bindings/:character', characterController.deleteVoiceBinding);

module.exports = router;

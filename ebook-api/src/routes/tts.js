const express = require('express');
const multer = require('multer');
const path = require('path');
const ttsController = require('../controllers/ttsController');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../public/uploads') });

router.get('/providers', ttsController.getProviders);
router.get('/voice-profiles', ttsController.getVoiceProfiles);
router.get('/provider-voices', ttsController.getProviderVoices);
router.get('/voices', ttsController.getVoices);
router.post('/voices', upload.single('file'), ttsController.createVoice);
router.post('/synthesize', ttsController.synthesize);
router.post('/tts', ttsController.synthesize);

module.exports = router;

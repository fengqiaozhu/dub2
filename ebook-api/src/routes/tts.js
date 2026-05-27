const express = require('express');
const multer = require('multer');
const path = require('path');
const ttsController = require('../controllers/ttsController');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../public/uploads') });

router.get('/providers', ttsController.getProviders);
router.get('/providers/status', ttsController.getProviderStatuses);
router.get('/voice-profiles', ttsController.getVoiceProfiles);
router.post('/voice-profiles', upload.single('file'), ttsController.createVoiceProfile);
router.post('/voice-profiles/:id/clone', ttsController.cloneVoiceProfile);
router.delete('/voice-profiles/:id', ttsController.deleteVoiceProfile);
router.get('/provider-voices', ttsController.getProviderVoices);
router.get('/voice-favorites', ttsController.getVoiceFavorites);
router.get('/voices', ttsController.getVoices);
router.get('/media-proxy', ttsController.proxyMedia);
router.post('/voice-favorites', ttsController.saveVoiceFavorite);
router.delete('/voice-favorites', ttsController.deleteVoiceFavorite);
router.post('/voices', upload.single('file'), ttsController.createVoice);
router.post('/synthesize', ttsController.synthesize);
router.post('/tts', ttsController.synthesize);

module.exports = router;

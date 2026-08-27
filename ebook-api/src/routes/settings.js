const express = require('express');
const settingController = require('../controllers/settingController');

const router = express.Router();

// System settings routes
router.get('/system', settingController.getSystemSettings);
router.post('/system', settingController.saveSystemSettings);

// AI configs routes
router.get('/ai', settingController.getAiConfigs);
router.post('/ai', settingController.createAiConfig);
router.put('/ai/:id', settingController.updateAiConfig);
router.delete('/ai/:id', settingController.deleteAiConfig);
router.post('/ai/:id/active', settingController.setActiveAiConfig);

// TTS configs routes
router.get('/tts', settingController.getTtsConfigs);
router.get('/tts/fish-audio/models', settingController.getFishAudioModels);
router.post('/tts', settingController.createTtsConfig);
router.put('/tts/:id', settingController.updateTtsConfig);
router.delete('/tts/:id', settingController.deleteTtsConfig);
router.post('/tts/:id/active', settingController.setActiveTtsConfig);

module.exports = router;

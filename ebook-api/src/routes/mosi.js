const express = require('express');
const multer = require('multer');
const path = require('path');
const mosiController = require('../controllers/mosiController');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../public/uploads') });

// Voices (获取用户自己克隆的音色)
router.get('/voices', mosiController.getVoices);

// System Voices (获取系统预置音色)
router.get('/system-voices', mosiController.getSystemVoices);

// Voice Cloning
router.post('/voices', upload.single('file'), mosiController.createVoice);
router.post('/create-voice', upload.single('file'), mosiController.createVoice);
router.post('/tts', mosiController.synthesize);

module.exports = router;

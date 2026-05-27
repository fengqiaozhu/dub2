const express = require('express');
const multer = require('multer');
const characterController = require('../controllers/characterController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// 单条对白操作
router.post('/:id/redub', characterController.redubDialogue);
router.post('/:id/clear-audio', characterController.clearAudio);
router.post('/:id/audio', upload.single('audio'), characterController.saveEditedAudio);
router.put('/:id', characterController.updateDialogue);
router.delete('/:id', characterController.deleteDialogue);

module.exports = router;

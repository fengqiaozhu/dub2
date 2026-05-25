const express = require('express');
const characterController = require('../controllers/characterController');

const router = express.Router();

// 单条对白操作
router.post('/:id/redub', characterController.redubDialogue);
router.post('/:id/clear-audio', characterController.clearAudio);
router.put('/:id', characterController.updateDialogue);
router.delete('/:id', characterController.deleteDialogue);

module.exports = router;

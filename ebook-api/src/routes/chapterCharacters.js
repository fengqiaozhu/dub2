const express = require('express');
const characterController = require('../controllers/characterController');

const router = express.Router();

// 对白 CRUD（放在 books/chapters 路由之前，避免路径冲突）
router.get('/:id/dialogues', characterController.getDialogues);
router.post('/:id/dialogues', characterController.createDialogue);

module.exports = router;

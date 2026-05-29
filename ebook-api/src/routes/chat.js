const express = require('express');
const chatController = require('../controllers/chatController');

const router = express.Router();

// 获取当前对话模型信息
router.get('/model', chatController.getChatModel);

// 开启流式对话
router.post('/', chatController.chat);

module.exports = router;

const express = require('express');
const chapterController = require('../controllers/chapterController');

const router = express.Router();

router.put('/:id', chapterController.updateAnnotation);
router.delete('/:id', chapterController.deleteAnnotation);

module.exports = router;

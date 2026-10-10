const express = require('express');
const jobController = require('../controllers/jobController');

const router = express.Router();

router.get('/', jobController.getJobs);
router.post('/:id/cancel', jobController.cancelJob);
router.delete('/:id/cancel', jobController.cancelJob);
router.get('/:id', jobController.getJob);

module.exports = router;

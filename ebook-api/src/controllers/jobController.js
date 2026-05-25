const jobRepository = require('../repositories/sqlite/SqliteJobRepository');

class JobController {
  async getJob(req, res) {
    try {
      const jobId = req.params.id;
      const job = jobRepository.findById(jobId);
      
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({ data: job });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getJobs(req, res) {
    try {
      // Allow optional type, target_id, and status
      const { type, target_id, status, limit, offset } = req.query;
      
      const filters = {
        type: type || undefined,
        target_id: target_id || undefined,
        status: status || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined
      };

      const jobs = jobRepository.findAll(filters);
      
      res.json({ data: jobs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new JobController();

const fs = require('fs');
const jobManager = require('../services/jobManager');
const mosiService = require('../services/mosiService');

class MosiController {
  async createVoice(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const filePath = req.file.path;
      const text = req.body.text || ''; 

      const jobId = await jobManager.startJob(
        'tts_clone', 
        null, // No specific target id
        'ttsCreateVoiceJob.js',
        { provider: 'mosi', filePath, fileName: req.file.originalname, text }
      );

      res.status(202).json({
        message: 'Voice clone job started',
        data: {
          jobId,
          status: 'PENDING'
        }
      });
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  }

  async getVoices(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const status = req.query.status;

      const result = await mosiService.getVoices(limit, offset, status);
      res.json({ data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSystemVoices(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const result = await mosiService.getSystemVoices(limit, offset);
      res.json({ data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async synthesize(req, res) {
    try {
      const { text, voice_id, options, intent, performance, output } = req.body;
      
      if (!text || !voice_id) {
        return res.status(400).json({ error: 'text and voice_id are required' });
      }

      const jobId = await jobManager.startJob(
        'tts_synthesize',
        voice_id, // Target id can be voice_id here
        'ttsSynthesizeJob.js',
        { provider: 'mosi', text, voice_id, options: options || {}, intent, performance, output }
      );

      res.status(202).json({
        message: 'Speech synthesize job started',
        data: {
          jobId,
          status: 'PENDING'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new MosiController();

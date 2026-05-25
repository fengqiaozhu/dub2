const jobManager = require('../services/jobManager');
const ttsService = require('../services/tts');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { voiceProfileRepository } = require('../repositories');
const { providerVoiceRepository } = require('../repositories');

class TtsController {
  getProviders(req, res) {
    try {
      res.json({ data: ttsService.getProviders() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getVoices(req, res) {
    try {
      const provider = req.query.provider || 'mosi';
      const kind = req.query.kind || 'all';
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;
      const status = req.query.status;

      const result = await ttsService.listVoices({ provider, kind, limit, offset, status });
      res.json({ data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getVoiceProfiles(req, res) {
    try {
      const limit = parseInt(req.query.limit, 10) || 100;
      const offset = parseInt(req.query.offset, 10) || 0;
      const search = req.query.search || '';
      const profiles = voiceProfileRepository.findAll({ limit, offset, search });
      res.json({ data: profiles });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getProviderVoices(req, res) {
    try {
      const limit = parseInt(req.query.limit, 10) || 100;
      const offset = parseInt(req.query.offset, 10) || 0;
      const { provider, kind, status } = req.query;
      const voices = providerVoiceRepository.findAll({ provider, kind, status, limit, offset });
      res.json({ data: voices });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createVoice(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Audio file is required' });
      }

      const provider = req.body.provider || req.query.provider || 'mosi';
      const filePath = req.file.path;
      const text = req.body.text || '';
      let voiceProfileId = req.body.voice_profile_id || null;

      if (!voiceProfileId && req.body.save_profile !== 'false') {
        const sampleDir = path.join(__dirname, '../../public/voice-samples');
        fs.mkdirSync(sampleDir, { recursive: true });

        const ext = path.extname(req.file.originalname || '') || path.extname(filePath);
        const sampleFilename = `sample_${randomUUID()}${ext}`;
        const samplePath = path.join(sampleDir, sampleFilename);
        fs.copyFileSync(filePath, samplePath);

        voiceProfileId = voiceProfileRepository.create({
          name: req.body.name || req.file.originalname || '未命名音色',
          description: req.body.description,
          sample_text: text,
          sample_audio_url: `/voice-samples/${sampleFilename}`,
          language: req.body.language,
          consent_status: req.body.consent_status || 'unknown'
        });
      }

      const jobId = await jobManager.startJob(
        'tts_clone',
        voiceProfileId,
        'ttsCreateVoiceJob.js',
        { provider, filePath, text, voice_profile_id: voiceProfileId }
      );

      res.status(202).json({
        message: 'Voice clone job started',
        data: {
          jobId,
          status: 'PENDING'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async synthesize(req, res) {
    try {
      const {
        provider = 'mosi',
        text,
        voice_id,
        provider_voice_id,
        model,
        options,
        intent,
        performance,
        output
      } = req.body;
      const voiceId = provider_voice_id || voice_id;

      if (!text || !voiceId) {
        return res.status(400).json({ error: 'text and voice_id are required' });
      }

      const jobId = await jobManager.startJob(
        'tts_synthesize',
        voiceId,
        'ttsSynthesizeJob.js',
        { provider, text, voice_id: voiceId, model, options: options || {}, intent, performance, output }
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

module.exports = new TtsController();

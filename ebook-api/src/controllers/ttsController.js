const jobManager = require('../services/jobManager');
const ttsService = require('../services/tts');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { randomUUID } = require('crypto');
const {
  voiceProfileRepository,
  providerVoiceRepository,
  voiceFavoriteRepository
} = require('../repositories');

const MEDIA_PROXY_ALLOWED_HOSTS = [
  'cdn.mosi.cn',
  'studio.mosi.cn',
  'fish.audio',
  'api.fish.audio',
  'platform.r2.fish.audio'
];

function isAllowedMediaHost(hostname) {
  return MEDIA_PROXY_ALLOWED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function normalizePagedVoices(result, limit, offset) {
  const voices = result.voices || [];
  const numericTotal = Number(result.total);
  const total = Number.isFinite(numericTotal) ? numericTotal : null;
  const effectiveLimit = typeof result.page_size === 'number' ? result.page_size : limit;
  const nextOffset = offset + voices.length;
  return {
    ...result,
    voices,
    limit,
    offset,
    next_offset: nextOffset,
    has_more: total !== null ? nextOffset < total : voices.length >= effectiveLimit
  };
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function saveVoiceSample(file, fields = {}) {
  const sampleDir = path.join(__dirname, '../../public/voice-samples');
  fs.mkdirSync(sampleDir, { recursive: true });

  const ext = path.extname(file.originalname || '') || path.extname(file.path);
  const sampleFilename = `sample_${randomUUID()}${ext}`;
  const samplePath = path.join(sampleDir, sampleFilename);
  fs.copyFileSync(file.path, samplePath);

  const voiceProfileId = voiceProfileRepository.create({
    name: fields.name || file.originalname || '未命名音色',
    description: fields.description,
    sample_text: fields.text || fields.sample_text,
    sample_audio_url: `/voice-samples/${sampleFilename}`,
    language: fields.language,
    consent_status: fields.consent_status || 'unknown'
  });

  return {
    voiceProfileId,
    samplePath,
    sampleFilename,
    sampleAudioUrl: `/voice-samples/${sampleFilename}`
  };
}

function resolvePublicFilePath(relativeUrl) {
  if (!relativeUrl || String(relativeUrl).startsWith('http')) return null;
  const publicRoot = path.resolve(__dirname, '../../public');
  const pathname = String(relativeUrl).split('?')[0].replace(/^\/+/, '');
  const filePath = path.resolve(publicRoot, pathname);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return null;
  return filePath;
}

class TtsController {
  getProviders(req, res) {
    try {
      res.json({ data: ttsService.getProviders() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getProviderStatuses(req, res) {
    try {
      const statuses = await ttsService.getProviderStatuses();
      res.json({ data: statuses });
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
      res.json({ data: normalizePagedVoices(result, limit, offset) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getVoiceFavorites(req, res) {
    try {
      res.json({ data: voiceFavoriteRepository.findAll() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  saveVoiceFavorite(req, res) {
    try {
      const {
        provider,
        provider_voice_id,
        voice_source = 'clone',
        voice_profile_id,
        name_snapshot
      } = req.body;

      if (!voice_profile_id && !provider_voice_id) {
        return res.status(400).json({ error: 'provider_voice_id or voice_profile_id is required' });
      }

      const favorite = voiceFavoriteRepository.upsert({
        provider,
        provider_voice_id,
        voice_source,
        voice_profile_id,
        name_snapshot
      });
      res.json({ data: favorite });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  deleteVoiceFavorite(req, res) {
    try {
      const deleted = voiceFavoriteRepository.delete({
        provider: req.query.provider,
        provider_voice_id: req.query.provider_voice_id,
        voice_source: req.query.voice_source,
        voice_profile_id: req.query.voice_profile_id
      });

      if (!deleted) {
        return res.status(404).json({ error: 'Favorite not found' });
      }

      res.json({ message: 'Voice favorite deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async proxyMedia(req, res) {
    try {
      const rawUrl = req.query.url;
      if (!rawUrl) {
        return res.status(400).json({ error: 'url is required' });
      }

      const target = new URL(rawUrl);
      if (!['http:', 'https:'].includes(target.protocol) || !isAllowedMediaHost(target.hostname)) {
        return res.status(400).json({ error: 'media host is not allowed' });
      }

      const response = await axios.get(target.toString(), {
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'ebook-api-media-proxy/1.0'
        }
      });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }

      response.data.pipe(res);
    } catch (error) {
      const status = error.response?.status || 502;
      res.status(status).json({ error: 'Failed to proxy media' });
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

  async deleteVoiceProfile(req, res) {
    try {
      const voiceProfileId = req.params.id;
      const profile = voiceProfileRepository.findById(voiceProfileId);
      if (!profile) {
        return res.status(404).json({ error: 'Voice profile not found' });
      }

      const providerVoices = providerVoiceRepository.findByProfileId(voiceProfileId);
      const remoteResults = [];
      for (const voice of providerVoices) {
        const result = await ttsService.deleteVoice({
          provider: voice.provider,
          voiceId: voice.provider_voice_id
        });
        remoteResults.push({
          provider: voice.provider,
          provider_voice_id: voice.provider_voice_id,
          result
        });
      }

      voiceProfileRepository.delete(voiceProfileId);
      res.json({ data: { deleted: true, remote: remoteResults } });
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

  async createVoiceProfile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Audio file is required' });
      }

      const text = req.body.text || req.body.sample_text || '';
      const saved = saveVoiceSample(req.file, { ...req.body, text });
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      const cloneProvider = req.body.clone_provider || req.body.provider;
      const shouldClone = parseBoolean(req.body.clone, false) || parseBoolean(req.body.clone_to_provider, false);
      let jobId = null;

      if (shouldClone && cloneProvider) {
        jobId = await jobManager.startJob(
          'tts_clone',
          saved.voiceProfileId,
          'ttsCreateVoiceJob.js',
          {
            provider: cloneProvider,
            filePath: saved.samplePath,
            fileName: req.file.originalname || saved.sampleFilename,
            text,
            voice_profile_id: saved.voiceProfileId,
            name: req.body.name || req.file.originalname,
            description: req.body.description,
            cleanupFile: false
          }
        );
      }

      res.status(201).json({
        message: shouldClone ? 'Voice profile created and clone job started' : 'Voice profile created',
        data: {
          voice_profile_id: saved.voiceProfileId,
          sample_audio_url: saved.sampleAudioUrl,
          jobId,
          status: jobId ? 'PENDING' : 'READY'
        }
      });
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  }

  async cloneVoiceProfile(req, res) {
    try {
      const voiceProfileId = req.params.id;
      const profile = voiceProfileRepository.findById(voiceProfileId);
      if (!profile) {
        return res.status(404).json({ error: 'Voice profile not found' });
      }

      const provider = req.body.provider || req.query.provider || 'mosi';
      const filePath = resolvePublicFilePath(profile.sample_audio_url);
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Voice profile sample audio is missing' });
      }

      const jobId = await jobManager.startJob(
        'tts_clone',
        voiceProfileId,
        'ttsCreateVoiceJob.js',
        {
          provider,
          filePath,
          fileName: path.basename(filePath),
          text: req.body.text || profile.sample_text || '',
          voice_profile_id: voiceProfileId,
          name: req.body.name || profile.name,
          description: req.body.description || profile.description,
          cleanupFile: false
        }
      );

      res.status(202).json({
        message: 'Voice clone job started',
        data: {
          jobId,
          voice_profile_id: voiceProfileId,
          provider,
          status: 'PENDING'
        }
      });
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
        voiceProfileId = saveVoiceSample(req.file, { ...req.body, text }).voiceProfileId;
      }

      const jobId = await jobManager.startJob(
        'tts_clone',
        voiceProfileId,
        'ttsCreateVoiceJob.js',
        {
          provider,
          filePath,
          fileName: req.file.originalname,
          text,
          voice_profile_id: voiceProfileId,
          name: req.body.name || req.file.originalname,
          description: req.body.description
        }
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

      if (provider === 'fish_audio') {
        const fishAudioService = require('../services/fishAudioService');
        const credit = await fishAudioService.getApiCredit();
        if (!credit.available) {
          return res.status(402).json({
            error: credit.reason || 'Fish Audio API credit is insufficient',
            provider,
            credit: credit.credit
          });
        }
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

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createReadStream } = require('fs');
const axios = require('axios');
const { appendMarker } = require('./tts/voiceProfileIdentity');
const storageService = require('./storage/storageService');
const { mediaUrlForKey } = require('./storage/keyBuilder');

const DEFAULT_MODEL = process.env.FISH_DEFAULT_MODEL || 's2-pro';
const DEFAULT_FORMAT = process.env.FISH_DEFAULT_FORMAT || 'mp3';
const DEFAULT_TIMEOUT_SECONDS = parseInt(process.env.FISH_TIMEOUT_SECONDS, 10) || 240;

function normalizeVoiceState(state) {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'trained') return 'DONE';
  if (normalized === 'failed') return 'FAILED';
  if (normalized === 'training' || normalized === 'created') return 'PENDING';
  return state || 'UNKNOWN';
}

function pickExtension(format) {
  if (['mp3', 'wav', 'opus', 'pcm'].includes(format)) return format;
  return 'mp3';
}

function buildPromptedText(text, options = {}) {
  const prompts = [];
  if (options.stylePrompt) prompts.push(options.stylePrompt);
  if (options.emotion) prompts.push(typeof options.emotion === 'string' ? options.emotion : JSON.stringify(options.emotion));
  if (prompts.length === 0) return text;
  return `[${prompts.join('; ')}] ${text}`;
}

function isRetryableBackendError(error) {
  if (!error || error.statusCode === 401 || error.statusCode === 402 || error.statusCode === 403) {
    return false;
  }
  const message = `${error.message || ''} ${JSON.stringify(error.body || '')}`.toLowerCase();
  return error.statusCode === 400 || error.statusCode === 422 || message.includes('model') || message.includes('backend');
}

class FishAudioService {
  constructor() {
    this.client = null;
    this._cachedKey = null;
  }

  async getApiKey() {
    try {
      const { ttsConfigRepository } = require('../repositories');
      const activeDbConfig = await ttsConfigRepository.findActiveByProvider('fish_audio');
      if (activeDbConfig && activeDbConfig.api_key) {
        return activeDbConfig.api_key;
      }
    } catch (err) {
      console.warn('Failed to fetch active Fish Audio config from tts_configs:', err.message);
    }

    return process.env.FISH_API_KEY;
  }

  async getClient() {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('FISH_API_KEY is not configured');
    }
    if (!this.client || this._cachedKey !== apiKey) {
      const { FishAudioClient } = await import('fish-audio');
      this.client = new FishAudioClient({ apiKey });
      this._cachedKey = apiKey;
    }
    return this.client;
  }

  async listVoices({ kind = 'clone', limit = 50, offset = 0, status, self = true } = {}) {
    const pageSize = Math.max(1, limit);
    const pageNumber = Math.floor(offset / pageSize) + 1;
    const client = await this.getClient();
    const result = await client.voices.search({
      page_size: pageSize,
      page_number: pageNumber,
      self
    });
    const voices = (result.items || [])
      .filter((voice) => voice.type === 'tts')
      .filter((voice) => !status || normalizeVoiceState(voice.state) === status || voice.state === status);

    return {
      provider: 'fish_audio',
      kind,
      voices,
      total: result.total,
      page_size: result.page_size,
      page_number: result.page_number
    };
  }

  async getVoice(voiceId) {
    const client = await this.getClient();
    return client.voices.get(voiceId);
  }

  async getApiCredit({ checkFreeCredit = true, teamId } = {}) {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return {
        configured: false,
        available: false,
        reason: 'FISH_API_KEY is not configured'
      };
    }

    try {
      const params = new URLSearchParams({
        check_free_credit: checkFreeCredit ? 'true' : 'false'
      });
      if (teamId || process.env.FISH_TEAM_ID) {
        params.append('team_id', teamId || process.env.FISH_TEAM_ID);
      }

      const response = await axios.get(`https://api.fish.audio/wallet/self/api-credit?${params.toString()}`, {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      const credit = Number(response.data?.credit || 0);

      return {
        configured: true,
        available: credit > 0,
        credit,
        raw: response.data,
        reason: credit > 0 ? null : 'Fish Audio API credit is insufficient'
      };
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      return {
        configured: true,
        available: false,
        status,
        reason: status === 401 ? 'Fish Audio API key is unauthorized' : message
      };
    }
  }

  async cloneVoice({ filePath, text = '', name, description, marker, onProgress }) {
    if (!filePath) {
      throw new Error('filePath is required');
    }
    if (onProgress) onProgress(10);

    const request = {
      title: name || path.basename(filePath, path.extname(filePath)) || 'Voice Model',
      voices: [createReadStream(filePath)],
      visibility: 'private',
      enhance_audio_quality: true
    };
    if (description || marker) request.description = appendMarker(description, marker);
    if (text) request.texts = [text];

    const client = await this.getClient();
    const response = await client.voices.ivc.create(request);
    if (onProgress) onProgress(100);

    return {
      voice_id: response._id,
      voiceId: response._id,
      model: DEFAULT_MODEL,
      status: normalizeVoiceState(response.state),
      state: response.state,
      marker,
      raw: response
    };
  }

  async synthesizeSpeech(text, voiceId, options = {}) {
    if (!text) {
      throw new Error('text is required');
    }
    if (!voiceId) {
      throw new Error('voiceId is required');
    }

    const format = options.outputFormat || options.format || DEFAULT_FORMAT;
    const request = {
      text: buildPromptedText(text, options),
      reference_id: voiceId,
      format,
      normalize: options.normalize !== undefined ? options.normalize : true,
      latency: options.latency || 'balanced'
    };

    if (options.speed || options.volume) {
      request.prosody = {};
      if (options.speed) request.prosody.speed = options.speed;
      if (options.volume) request.prosody.volume = options.volume;
    }
    if (options.chunk_length) request.chunk_length = options.chunk_length;
    if (options.temperature) request.temperature = options.temperature;
    if (options.top_p) request.top_p = options.top_p;
    if (options.sample_rate) request.sample_rate = options.sample_rate;
    if (options.mp3_bitrate) request.mp3_bitrate = options.mp3_bitrate;
    if (options.opus_bitrate) request.opus_bitrate = options.opus_bitrate;

    const backend = options.backend || options.model || DEFAULT_MODEL;
    let audioStream;
    try {
      const client = await this.getClient();
      audioStream = await client.textToSpeech.convert(
        request,
        backend,
        { timeoutInSeconds: options.timeoutInSeconds || DEFAULT_TIMEOUT_SECONDS }
      );
    } catch (error) {
      if (backend === 's2-pro' && isRetryableBackendError(error)) {
        const client = await this.getClient();
        audioStream = await client.textToSpeech.convert(
          request,
          undefined,
          { timeoutInSeconds: options.timeoutInSeconds || DEFAULT_TIMEOUT_SECONDS }
        );
      } else {
        throw error;
      }
    }

    const buffer = Buffer.from(await new Response(audioStream).arrayBuffer());
    const ext = pickExtension(format);
    const key = options.storage?.key || `jobs/tts/${randomUUID()}.${ext}`;
    await storageService.putObject(key, buffer, {
      contentType: ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`,
      entityType: options.storage?.entityType || 'tts_audio',
      entityId: options.storage?.entityId || null,
      metadata: {
        provider: 'fish_audio',
        voice_id: voiceId,
        backend,
        format
      }
    });

    return {
      url: mediaUrlForKey(key),
      duration_s: null,
      usage: null,
      meta_info: {
        provider: 'fish_audio',
        voice_id: voiceId,
        backend,
        format,
        bytes: buffer.length
      }
    };
  }
}

module.exports = new FishAudioService();

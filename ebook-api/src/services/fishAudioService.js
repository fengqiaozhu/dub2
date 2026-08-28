const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createReadStream } = require('fs');
const axios = require('axios');
const { appendMarker } = require('./tts/voiceProfileIdentity');
const storageService = require('./storage/storageService');
const { mediaUrlForKey } = require('./storage/keyBuilder');
const { summarizeFishAccount } = require('./fishAudioAccount');
const providerConfigService = require('./tts/providerConfigService');

const DEFAULT_MODEL = 's2.1-pro';
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

  async getActiveConfig() {
    try {
      return await providerConfigService.resolveProviderConfig('fish_audio');
    } catch (err) {
      console.warn('Failed to resolve active Fish Audio config:', err.message);
      return null;
    }
  }

  async getApiKey() {
    const activeDbConfig = await this.getActiveConfig();
    return activeDbConfig?.api_key || null;
  }

  async getConfiguredModel({ accountStatus } = {}) {
    const activeDbConfig = await this.getActiveConfig();
    const configuredModel = String(activeDbConfig?.model || '').trim();
    return configuredModel || accountStatus?.recommended_model || DEFAULT_MODEL;
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

    const params = new URLSearchParams({
      check_free_credit: checkFreeCredit ? 'true' : 'false'
    });
    if (teamId || process.env.FISH_TEAM_ID) {
      params.append('team_id', teamId || process.env.FISH_TEAM_ID);
    }

    const requestOptions = {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    };
    const [creditResult, packageResult] = await Promise.allSettled([
      axios.get(`https://api.fish.audio/wallet/self/api-credit?${params.toString()}`, requestOptions),
      axios.get('https://api.fish.audio/wallet/self/package', requestOptions)
    ]);

    const creditData = creditResult.status === 'fulfilled' ? creditResult.value.data : {};
    const packageData = packageResult.status === 'fulfilled' ? packageResult.value.data : {};
    const summary = summarizeFishAccount({ creditData, packageData });
    const failedRequest = creditResult.status === 'rejected'
      ? creditResult.reason
      : packageResult.status === 'rejected'
        ? packageResult.reason
        : null;

    if (!summary.available && creditResult.status === 'rejected' && packageResult.status === 'rejected') {
      const status = failedRequest?.response?.status;
      const message = failedRequest?.response?.data?.message || failedRequest?.message;
      return {
        configured: true,
        ...summary,
        status,
        reason: status === 401 ? 'Fish Audio API key is unauthorized' : message
      };
    }

    return {
      configured: true,
      ...summary,
      raw: creditData,
      package_raw: packageData,
      status: summary.available ? undefined : failedRequest?.response?.status,
      reason: summary.available
        ? null
        : failedRequest?.response?.data?.message
          || failedRequest?.message
          || 'Fish Audio API credit and package balance are insufficient'
    };
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
      model: await this.getConfiguredModel(),
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

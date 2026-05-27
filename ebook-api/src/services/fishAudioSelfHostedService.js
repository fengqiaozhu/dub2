const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_FORMAT = process.env.FISH_SELF_HOSTED_DEFAULT_FORMAT || 'wav';
const DEFAULT_TIMEOUT_SECONDS = parseInt(process.env.FISH_SELF_HOSTED_TIMEOUT_SECONDS, 10) || 600;
const REFERENCE_PREFIX = 'voice_profile_';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function pickExtension(format) {
  if (['wav', 'pcm', 'mp3', 'opus'].includes(format)) return format;
  return 'wav';
}

function normalizeReferenceIds(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.references)) return data.references;
  if (Array.isArray(data?.reference_ids)) return data.reference_ids;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getReferenceId(reference) {
  return String(reference?.reference_id || reference?.id || reference?.name || reference || '');
}

function buildReferenceIdForProfile(voiceProfileId) {
  return `${REFERENCE_PREFIX}${voiceProfileId}`;
}

function parseVoiceProfileId(referenceId) {
  const value = String(referenceId || '');
  if (!value.startsWith(REFERENCE_PREFIX)) return null;
  const id = value.slice(REFERENCE_PREFIX.length);
  return /^\d+$/.test(id) ? Number(id) : null;
}

function getRepositories() {
  return require('../repositories');
}

function normalizeReferenceVoice(reference) {
  const referenceId = getReferenceId(reference);
  const voiceProfileId = parseVoiceProfileId(referenceId);
  if (!voiceProfileId) return null;

  const {
    providerVoiceRepository,
    voiceProfileRepository
  } = getRepositories();
  const profile = voiceProfileRepository.findById(voiceProfileId);
  if (!profile) return null;

  const providerVoice = providerVoiceRepository.findByProviderVoiceId(
    'fish_audio_self_hosted',
    referenceId
  );

  return {
    id: referenceId,
    provider: 'fish_audio_self_hosted',
    provider_voice_id: referenceId,
    voice_profile_id: profile.id,
    name: profile.name,
    voice_profile_name: profile.name,
    source: 'clone',
    kind: 'clone',
    status: providerVoice?.status || 'DONE',
    sample_audio_url: profile.sample_audio_url,
    sample_text: profile.sample_text,
    language: profile.language,
    consent_status: profile.consent_status,
    raw: typeof reference === 'object' ? reference : { reference_id: referenceId },
    provider_meta: providerVoice?.provider_meta
  };
}

function formatErrorMessage(error) {
  const responseData = error.response?.data;
  if (typeof responseData === 'string' && responseData.trim()) return responseData;
  if (responseData?.message) return responseData.message;
  if (responseData?.detail) return JSON.stringify(responseData.detail);
  if (responseData && Object.keys(responseData).length > 0) return JSON.stringify(responseData);
  return error.message || 'Fish Audio self-hosted server is unavailable';
}

function buildReferenceId({ name, filePath, voiceProfileId }) {
  if (voiceProfileId) return buildReferenceIdForProfile(voiceProfileId);

  const source = name || path.basename(filePath || '', path.extname(filePath || '')) || 'voice';
  const safeName = source
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${safeName || 'voice'}_${randomUUID().slice(0, 8)}`;
}

function buildPromptedText(text, options = {}) {
  const prompts = [];
  if (options.stylePrompt) prompts.push(options.stylePrompt);
  if (options.emotion) prompts.push(typeof options.emotion === 'string' ? options.emotion : JSON.stringify(options.emotion));
  if (prompts.length === 0) return text;
  return `[${prompts.join('; ')}] ${text}`;
}

class FishAudioSelfHostedService {
  constructor() {
    this.baseUrl = normalizeBaseUrl(process.env.FISH_SELF_HOSTED_BASE_URL);
    this.audioDir = path.join(__dirname, '../../public/audio');
    fs.mkdirSync(this.audioDir, { recursive: true });
  }

  getBaseUrl() {
    this.baseUrl = normalizeBaseUrl(process.env.FISH_SELF_HOSTED_BASE_URL || this.baseUrl);
    return this.baseUrl;
  }

  getTimeoutMs(options = {}) {
    const seconds = options.timeoutInSeconds || DEFAULT_TIMEOUT_SECONDS;
    return seconds * 1000;
  }

  async getStatus() {
    const configured = Boolean(process.env.FISH_SELF_HOSTED_BASE_URL);
    try {
      const response = await axios.get(`${this.getBaseUrl()}/v1/references/list`, {
        timeout: 10000
      });
      return {
        configured,
        available: true,
        status: response.status,
        reason: null
      };
    } catch (error) {
      return {
        configured,
        available: false,
        status: error.response?.status,
        reason: formatErrorMessage(error)
      };
    }
  }

  async listVoices({ kind = 'clone', limit = 50, offset = 0 } = {}) {
    if (kind === 'system') {
      return {
        provider: 'fish_audio_self_hosted',
        kind,
        voices: [],
        total: 0
      };
    }

    const response = await axios.get(`${this.getBaseUrl()}/v1/references/list`, {
      timeout: 30000
    });
    const voices = normalizeReferenceIds(response.data)
      .map(normalizeReferenceVoice)
      .filter(Boolean);
    const pagedVoices = voices.slice(offset, offset + limit);

    return {
      provider: 'fish_audio_self_hosted',
      kind: kind === 'custom' ? 'clone' : kind,
      voices: pagedVoices,
      total: voices.length,
      page_size: limit,
      offset
    };
  }

  async cloneVoice({ filePath, text = '', name, voice_profile_id, onProgress }) {
    if (!filePath) {
      throw new Error('filePath is required');
    }
    if (!text) {
      throw new Error('text is required for Fish Audio self-hosted reference voices');
    }

    if (onProgress) onProgress(10);
    const referenceId = buildReferenceId({ name, filePath, voiceProfileId: voice_profile_id });
    const form = new FormData();
    form.append('id', referenceId);
    form.append('audio', fs.createReadStream(filePath));
    form.append('text', text);

    const response = await axios.post(`${this.getBaseUrl()}/v1/references/add`, form, {
      headers: form.getHeaders(),
      timeout: this.getTimeoutMs()
    });
    if (onProgress) onProgress(100);

    return {
      voice_id: referenceId,
      voiceId: referenceId,
      model: 's2-pro',
      status: 'DONE',
      state: 'DONE',
      raw: response.data || { reference_id: referenceId }
    };
  }

  async deleteVoice(voiceId) {
    if (!voiceId) {
      throw new Error('voiceId is required');
    }

    const response = await axios.delete(`${this.getBaseUrl()}/v1/references/delete`, {
      data: { reference_id: voiceId },
      headers: { 'Content-Type': 'application/json' },
      timeout: this.getTimeoutMs()
    });

    return response.data || { reference_id: voiceId };
  }

  async synthesizeSpeech(text, voiceId, options = {}) {
    if (!text) {
      throw new Error('text is required');
    }
    if (!voiceId) {
      throw new Error('voiceId is required');
    }

    const format = options.outputFormat || options.format || DEFAULT_FORMAT;
    const payload = {
      text: buildPromptedText(text, options),
      reference_id: voiceId,
      format,
      latency: options.latency || 'balanced',
      normalize: options.normalize !== undefined ? options.normalize : true,
      streaming: false
    };

    if (options.chunk_length) payload.chunk_length = options.chunk_length;
    if (options.seed !== undefined) payload.seed = options.seed;
    if (options.use_memory_cache) payload.use_memory_cache = options.use_memory_cache;
    if (options.max_new_tokens) payload.max_new_tokens = options.max_new_tokens;
    if (options.top_p) payload.top_p = options.top_p;
    if (options.repetition_penalty) payload.repetition_penalty = options.repetition_penalty;
    if (options.temperature) payload.temperature = options.temperature;

    const response = await axios.post(`${this.getBaseUrl()}/v1/tts`, payload, {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: this.getTimeoutMs(options)
    });

    const buffer = Buffer.from(response.data);
    const ext = pickExtension(format);
    const filename = `tts_${randomUUID()}.${ext}`;
    const filePath = path.join(this.audioDir, filename);
    fs.writeFileSync(filePath, buffer);

    return {
      url: `/audio/${filename}`,
      duration_s: null,
      usage: null,
      meta_info: {
        provider: 'fish_audio_self_hosted',
        voice_id: voiceId,
        format,
        bytes: buffer.length,
        base_url: this.getBaseUrl()
      }
    };
  }
}

module.exports = new FishAudioSelfHostedService();

const fishAudioService = require('../../fishAudioService');
const { extractMarker } = require('../voiceProfileIdentity');

function proxyMediaUrl(url) {
  if (!url || !String(url).startsWith('http')) return url;
  return `/api/tts/media-proxy?url=${encodeURIComponent(url)}`;
}

function getSampleAudioUrl(voice) {
  if (Array.isArray(voice.samples)) {
    return voice.samples.find((sample) => sample?.audio)?.audio;
  }
  return voice.samples?.audio;
}

function normalizeVoice(voice, kind = 'clone') {
  const statusMap = {
    trained: 'DONE',
    failed: 'FAILED',
    training: 'PENDING',
    created: 'PENDING'
  };
  const status = statusMap[String(voice.state || '').toLowerCase()] || voice.state || 'UNKNOWN';
  const markerInfo = extractMarker(voice);

  return {
    id: voice._id,
    provider: 'fish_audio',
    provider_voice_id: voice._id,
    name: voice.title || '未命名',
    voice_profile_id: markerInfo?.voice_profile_id || null,
    marker: markerInfo?.marker,
    source: kind,
    raw: voice,
    status,
    previewAudioUrl: proxyMediaUrl(getSampleAudioUrl(voice)),
    language: Array.isArray(voice.languages) ? voice.languages.join(', ') : undefined,
    description: voice.description,
    visibility: voice.visibility
  };
}

class FishAudioProvider {
  constructor() {
    this.id = 'fish_audio';
    this.displayName = 'Fish Audio';
  }

  getCapabilities() {
    return {
      provider: this.id,
      displayName: this.displayName,
      defaultModel: process.env.FISH_DEFAULT_MODEL || 's2-pro',
      voiceKinds: ['system', 'clone'],
      models: [
        {
          id: 's2-pro',
          label: 'Fish Audio S2-Pro',
          capabilities: {
            cloneVoice: true,
            systemVoices: true,
            emotionControl: 'prompt',
            speedControl: true,
            pitchControl: false,
            stylePrompt: true,
            durationControl: false,
            ssml: false,
            streaming: true,
            outputFormats: ['mp3', 'wav', 'opus', 'pcm']
          },
          limits: {
            timeoutMs: 240000
          }
        },
        {
          id: 's1',
          label: 'Fish Audio S1',
          capabilities: {
            cloneVoice: true,
            systemVoices: true,
            emotionControl: 'prompt',
            speedControl: true,
            pitchControl: false,
            stylePrompt: true,
            durationControl: false,
            ssml: false,
            streaming: true,
            outputFormats: ['mp3', 'wav', 'opus', 'pcm']
          },
          limits: {
            timeoutMs: 240000
          }
        }
      ]
    };
  }

  async listVoices({ kind = 'all', limit = 50, offset = 0, status } = {}) {
    if (kind === 'system') {
      const result = await fishAudioService.listVoices({
        kind: 'system',
        limit,
        offset,
        status,
        self: false
      });
      const voices = (result.voices || []).map((voice) => normalizeVoice(voice, 'system'));

      return {
        ...result,
        provider: this.id,
        kind,
        voices
      };
    }

    const result = await fishAudioService.listVoices({
      kind: 'clone',
      limit,
      offset,
      status,
      self: true
    });
    const voices = (result.voices || []).map((voice) => normalizeVoice(voice, 'clone'));

    return {
      ...result,
      provider: this.id,
      kind: kind === 'custom' ? 'clone' : kind,
      voices
    };
  }

  async cloneVoice({ filePath, text = '', name, description, marker, onProgress }) {
    return fishAudioService.cloneVoice({ filePath, text, name, description, marker, onProgress });
  }

  async synthesize({ text, voiceId, model, options = {} }) {
    return fishAudioService.synthesizeSpeech(text, voiceId, { ...options, model });
  }
}

module.exports = new FishAudioProvider();

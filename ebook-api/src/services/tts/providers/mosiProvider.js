const mosiService = require('../../mosiService');
const { extractMarker } = require('../voiceProfileIdentity');

function proxyMediaUrl(url) {
  if (!url || !String(url).startsWith('http')) return url;
  return `/api/tts/media-proxy?url=${encodeURIComponent(url)}`;
}

function hasUsableVoiceName(name) {
  const normalized = String(name || '').trim();
  return normalized && normalized !== '未命名';
}

function normalizeSystemVoice(voice) {
  return {
    id: voice.voiceId,
    provider: 'mosi',
    provider_voice_id: voice.voiceId,
    name: voice.voiceName,
    source: 'system',
    raw: voice,
    previewAudioUrl: proxyMediaUrl(voice.previewAudioUrl || voice.audioSampleUrl),
    language: voice.language,
    gender: voice.gender
  };
}

function normalizeCustomVoice(voice) {
  const providerVoiceId = voice.voice_id || voice.voiceId || voice.id;
  const markerInfo = extractMarker(voice);
  return {
    id: providerVoiceId,
    provider: 'mosi',
    provider_voice_id: providerVoiceId,
    voice_profile_id: markerInfo?.voice_profile_id || null,
    name: voice.name || voice.voiceName || voice.voice_name || `Voice ${providerVoiceId}`,
    description: voice.description || voice.desc,
    marker: markerInfo?.marker,
    source: 'clone',
    raw: voice,
    status: voice.status
  };
}

class MosiProvider {
  constructor() {
    this.id = 'mosi';
    this.displayName = 'Mosi';
  }

  getCapabilities() {
    return {
      provider: this.id,
      displayName: this.displayName,
      defaultModel: 'moss-tts',
      voiceKinds: ['system', 'clone'],
      models: [
        {
          id: 'moss-tts',
          label: 'Moss TTS',
          capabilities: {
            cloneVoice: true,
            systemVoices: true,
            emotionControl: 'none',
            speedControl: false,
            pitchControl: false,
            stylePrompt: false,
            durationControl: true,
            ssml: false,
            streaming: false,
            outputFormats: ['wav']
          },
          limits: {
            timeoutMs: 600000
          }
        }
      ]
    };
  }

  async listVoices({ kind = 'all', limit = 50, offset = 0, status } = {}) {
    if (kind === 'system') {
      const result = await mosiService.getSystemVoices(limit, offset);
      const voices = (result.voices || [])
        .filter((voice) => voice.voiceId && hasUsableVoiceName(voice.voiceName))
        .map(normalizeSystemVoice);
      return { ...result, provider: this.id, kind, voices };
    }

    if (kind === 'clone' || kind === 'custom') {
      const result = await mosiService.getVoices(limit, offset, status);
      const voices = (result.voices || [])
        .filter((voice) => (
          (voice.voice_id || voice.voiceId || voice.id) &&
          hasUsableVoiceName(voice.name || voice.voiceName || voice.voice_name)
        ))
        .map(normalizeCustomVoice);
      return { ...result, provider: this.id, kind: 'clone', voices };
    }

    const [systemResult, customResult] = await Promise.all([
      this.listVoices({ kind: 'system', limit, offset }),
      this.listVoices({ kind: 'clone', limit, offset, status })
    ]);

    return {
      provider: this.id,
      kind: 'all',
      voices: [...systemResult.voices, ...customResult.voices],
      groups: {
        system: systemResult,
        clone: customResult
      }
    };
  }

  async cloneVoice({ filePath, text = '', fileName, marker, onProgress }) {
    const result = await mosiService.uploadAndCloneVoice(filePath, text, onProgress, fileName);
    return {
      ...result,
      marker
    };
  }

  async synthesize({ text, voiceId, options = {} }) {
    return mosiService.synthesizeSpeech(text, voiceId, options);
  }
}

module.exports = new MosiProvider();

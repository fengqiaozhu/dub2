const mosiService = require('../../mosiService');

function normalizeSystemVoice(voice) {
  return {
    id: voice.voiceId,
    provider: 'mosi',
    provider_voice_id: voice.voiceId,
    name: voice.voiceName,
    source: 'system',
    raw: voice,
    previewAudioUrl: voice.previewAudioUrl,
    language: voice.language,
    gender: voice.gender
  };
}

function normalizeCustomVoice(voice) {
  return {
    id: voice.voice_id,
    provider: 'mosi',
    provider_voice_id: voice.voice_id,
    name: voice.name || voice.voiceName || '未命名',
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
      const voices = (result.voices || []).map(normalizeSystemVoice);
      return { ...result, provider: this.id, kind, voices };
    }

    if (kind === 'clone' || kind === 'custom') {
      const result = await mosiService.getVoices(limit, offset, status);
      const voices = (result.voices || []).map(normalizeCustomVoice);
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

  async cloneVoice({ filePath, text = '', onProgress }) {
    return mosiService.uploadAndCloneVoice(filePath, text, onProgress);
  }

  async synthesize({ text, voiceId, options = {} }) {
    return mosiService.synthesizeSpeech(text, voiceId, options);
  }
}

module.exports = new MosiProvider();

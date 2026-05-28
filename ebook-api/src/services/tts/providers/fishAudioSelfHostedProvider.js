const fishAudioSelfHostedService = require('../../fishAudioSelfHostedService');

class FishAudioSelfHostedProvider {
  constructor() {
    this.id = 'fish_audio_self_hosted';
    this.displayName = 'Fish Audio Self-Hosted';
  }

  getCapabilities() {
    return {
      provider: this.id,
      displayName: this.displayName,
      defaultModel: 's2-pro',
      voiceKinds: ['clone'],
      models: [
        {
          id: 's2-pro',
          label: 'Fish Speech S2-Pro Self-Hosted',
          capabilities: {
            cloneVoice: true,
            systemVoices: false,
            emotionControl: 'prompt',
            speedControl: false,
            pitchControl: false,
            stylePrompt: true,
            durationControl: false,
            ssml: false,
            streaming: false,
            outputFormats: ['wav', 'pcm', 'mp3', 'opus']
          },
          limits: {
            timeoutMs: 600000
          }
        }
      ]
    };
  }

  async getStatus() {
    return fishAudioSelfHostedService.getStatus();
  }

  async listVoices(params = {}) {
    return fishAudioSelfHostedService.listVoices(params);
  }

  async cloneVoice({ filePath, text = '', name, voice_profile_id, marker, onProgress }) {
    return fishAudioSelfHostedService.cloneVoice({ filePath, text, name, voice_profile_id, marker, onProgress });
  }

  async deleteVoice(voiceId) {
    return fishAudioSelfHostedService.deleteVoice(voiceId);
  }

  async synthesize({ text, voiceId, options = {} }) {
    return fishAudioSelfHostedService.synthesizeSpeech(text, voiceId, options);
  }
}

module.exports = new FishAudioSelfHostedProvider();

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storage/storageService');
const { mediaUrlForKey } = require('./storage/keyBuilder');
const { extractMosiErrorCode, summarizeMosiBilling } = require('./mosiAccount');

class MosiService {
  constructor() {
    this.audioDir = null;
  }

  async getActiveConfig() {
    try {
      const { ttsConfigRepository } = require('../repositories');
      const activeDbConfig = await ttsConfigRepository.findActiveByProvider('mosi');
      if (activeDbConfig) {
        return {
          baseUrl: activeDbConfig.api_url || 'https://studio.mosi.cn',
          apiKey: activeDbConfig.api_key
        };
      }
    } catch (err) {
      console.warn('Failed to fetch active Mosi config from tts_configs:', err.message);
    }

    // Fallback directly to environment variables
    const baseUrl = process.env.MOSI_BASE_URL || 'https://studio.mosi.cn';
    const apiKey = process.env.MOSI_API_KEY;
    return { baseUrl, apiKey };
  }

  async getBaseUrl() {
    const config = await this.getActiveConfig();
    return config.baseUrl;
  }

  async getApiKey() {
    const config = await this.getActiveConfig();
    return config.apiKey;
  }

  async getHeaders(isFormData = false) {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('MOSI_API_KEY is not configured');
    }
    
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
    };
    
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    
    return headers;
  }

  async getStatus() {
    const apiKey = await this.getApiKey();
    let usage = null;
    try {
      const { providerUsageRepository } = require('../repositories');
      usage = await providerUsageRepository.findByProvider('mosi');
    } catch (error) {
      console.warn('Failed to load Mosi usage summary:', error.message);
    }

    const configured = Boolean(apiKey);
    return {
      configured,
      available: configured,
      reason: configured ? null : 'MOSI_API_KEY is not configured',
      status: configured ? 'ready' : 'unconfigured',
      billing: summarizeMosiBilling(usage)
    };
  }

  async recordUsage(creditCost) {
    try {
      const { providerUsageRepository } = require('../repositories');
      return await providerUsageRepository.recordSuccess('mosi', creditCost);
    } catch (error) {
      console.warn('Failed to record Mosi usage:', error.message);
      return null;
    }
  }

  async recordError(error) {
    const data = error?.response?.data;
    const code = extractMosiErrorCode(data);
    if (!code) return null;
    try {
      const { providerUsageRepository } = require('../repositories');
      return await providerUsageRepository.recordError(
        'mosi',
        code,
        data?.message || data?.error?.message || error.message
      );
    } catch (trackingError) {
      console.warn('Failed to record Mosi error:', trackingError.message);
      return null;
    }
  }

  /**
   * Upload an audio file to Mosi to get a file_id
   */
  async uploadFile(filePath, fileName) {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), {
        filename: fileName || path.basename(filePath)
      });

      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders(true);
      const response = await axios.post(`${baseUrl}/api/v1/files/upload`, form, {
        headers: {
          ...headers,
          ...form.getHeaders()
        }
      });

      return response.data;
    } catch (error) {
      console.error('Mosi API upload error:', error.response?.data || error.message);
      throw new Error(`Upload failed: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }

  /**
   * Create a voice clone using file_id and optional transcription text
   */
  async createVoiceClone(fileId, text = '') {
    try {
      const payload = { file_id: fileId };
      if (text) {
        payload.text = text;
      }

      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const response = await axios.post(`${baseUrl}/api/v1/voice/clone`, payload, {
        headers
      });

      return response.data;
    } catch (error) {
      console.error('Mosi API clone error:', error.response?.data || error.message);
      throw new Error(`Voice clone failed: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }

  /**
   * Get a single voice details (used for polling)
   */
  async getVoice(voiceId) {
    try {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const response = await axios.get(`${baseUrl}/api/v1/voices/${voiceId}`, {
        headers
      });
      return response.data;
    } catch (error) {
      console.error(`Mosi API getVoice error for ${voiceId}:`, error.response?.data || error.message);
      throw new Error(`Failed to get voice: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }

  /**
   * Complete flow: Upload -> Clone -> Wait for ACTIVE
   */
  async uploadAndCloneVoice(filePath, text = '', onProgress = () => {}, fileName) {
    console.log(`Starting voice clone process... Uploading file...`);
    onProgress(10);
    const uploadResult = await this.uploadFile(filePath, fileName);
    const fileId = uploadResult.file_id;

    console.log(`File uploaded successfully (ID: ${fileId}). Creating voice clone...`);
    onProgress(30);
    const cloneResult = await this.createVoiceClone(fileId, text);
    const voiceId = cloneResult.voice_id;
    let status = cloneResult.status;

    console.log(`Voice clone created (ID: ${voiceId}). Status: ${status}`);
    onProgress(50);

    // Poll until status is ACTIVE or FAILED
    const maxRetries = 60; // Max 1 hour if we poll every 5s? Typically it takes a few seconds or minutes
    let retries = 0;
    
    while (status === 'PENDING' && retries < maxRetries) {
      console.log(`Waiting for voice ${voiceId} to become ACTIVE... (${retries}/${maxRetries})`);
      // Wait for 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const voiceInfo = await this.getVoice(voiceId);
      status = voiceInfo.status;
      retries++;
      
      // Calculate progress between 50 and 99
      const currentProgress = 50 + Math.floor((retries / maxRetries) * 49);
      onProgress(currentProgress);
    }

    if (status === 'FAILED') {
      throw new Error(`Voice clone failed for voice_id: ${voiceId}`);
    } else if (status === 'PENDING') {
      throw new Error(`Voice clone timed out waiting for ACTIVE status for voice_id: ${voiceId}`);
    }

    console.log(`Voice ${voiceId} is now ACTIVE.`);
    return await this.getVoice(voiceId);
  }

  /**
   * Get list of voices
   */
  async getVoices(limit = 50, offset = 0, status) {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString()
      });
      
      if (status) {
        params.append('status', status);
      }

      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const response = await axios.get(`${baseUrl}/api/v1/voices?${params.toString()}`, {
        headers
      });

      return response.data;
    } catch (error) {
      console.error('Mosi API getVoices error:', error.response?.data || error.message);
      throw new Error(`Failed to get voices: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }

  /**
   * Get list of system preset voices (studio-api)
   */
  async getSystemVoices(limit = 20, offset = 0) {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString()
      });
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const response = await axios.get(`${baseUrl}/studio-api/v1/voices?${params.toString()}`, {
        headers
      });
      return response.data;
    } catch (error) {
      console.error('Mosi API getSystemVoices error:', error.response?.data || error.message);
      throw new Error(`Failed to get system voices: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }

  /**
   * Synthesize speech and save to local file
   */
  async synthesizeSpeech(text, voiceId, options = {}) {
    try {
      const payload = {
        model: 'moss-tts',
        text: text,
        voice_id: voiceId,
        meta_info: options.meta_info || false,
        sampling_params: {
          max_new_tokens: options.max_new_tokens || 20000,
          temperature: options.temperature || 1.7,
          top_p: options.top_p || 0.8,
          top_k: options.top_k || 25
        }
      };

      if (options.expected_duration_sec) {
        payload.expected_duration_sec = options.expected_duration_sec;
      }

      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const response = await axios.post(`${baseUrl}/api/v1/audio/speech`, payload, {
        headers,
        timeout: 600000 // 10 mins as per docs (600s)
      });

      const creditCost = response.data.usage?.credit_cost ?? response.data.meta_info?.cost ?? null;
      await this.recordUsage(creditCost);

      const audioDataB64 = response.data.audio_data;
      if (!audioDataB64) {
        throw new Error('No audio data returned from Mosi');
      }

      const audioBuffer = Buffer.from(audioDataB64, 'base64');
      const key = options.storage?.key || `jobs/tts/${uuidv4()}.wav`;
      await storageService.putObject(key, audioBuffer, {
        contentType: 'audio/wav',
        entityType: options.storage?.entityType || 'tts_audio',
        entityId: options.storage?.entityId || null,
        metadata: {
          provider: 'mosi',
          voice_id: voiceId
        }
      });
      
      return {
        url: mediaUrlForKey(key),
        duration_s: response.data.duration_s,
        usage: response.data.usage,
        meta_info: response.data.meta_info
      };

    } catch (error) {
      await this.recordError(error);
      console.error('Mosi API synthesize error:', error.response?.data || error.message);
      const wrappedError = new Error(`Synthesize failed: ${JSON.stringify(error.response?.data || error.message)}`);
      wrappedError.statusCode = error.response?.status;
      wrappedError.code = extractMosiErrorCode(error.response?.data) || error.code;
      wrappedError.provider = 'mosi';
      throw wrappedError;
    }
  }
}

module.exports = new MosiService();

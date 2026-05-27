const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class MosiService {
  constructor() {
    this.baseUrl = process.env.MOSI_BASE_URL || 'https://studio.mosi.cn';
    this.apiKey = process.env.MOSI_API_KEY;
    
    // Ensure public audio directory exists
    this.audioDir = path.join(__dirname, '../../public/audio');
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
  }

  getHeaders(isFormData = false) {
    if (!this.apiKey) {
      throw new Error('MOSI_API_KEY is not configured');
    }
    
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
    };
    
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    
    return headers;
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

      const response = await axios.post(`${this.baseUrl}/api/v1/files/upload`, form, {
        headers: {
          ...this.getHeaders(true),
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

      const response = await axios.post(`${this.baseUrl}/api/v1/voice/clone`, payload, {
        headers: this.getHeaders()
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
      const response = await axios.get(`${this.baseUrl}/api/v1/voices/${voiceId}`, {
        headers: this.getHeaders()
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

      const response = await axios.get(`${this.baseUrl}/api/v1/voices?${params.toString()}`, {
        headers: this.getHeaders()
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
      const response = await axios.get(`${this.baseUrl}/studio-api/v1/voices?${params.toString()}`, {
        headers: this.getHeaders()
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

      const response = await axios.post(`${this.baseUrl}/api/v1/audio/speech`, payload, {
        headers: this.getHeaders(),
        timeout: 600000 // 10 mins as per docs (600s)
      });

      const audioDataB64 = response.data.audio_data;
      if (!audioDataB64) {
        throw new Error('No audio data returned from Mosi');
      }

      // Convert Base64 to binary buffer and save as .wav
      const audioBuffer = Buffer.from(audioDataB64, 'base64');
      const filename = `tts_${uuidv4()}.wav`;
      const filePath = path.join(this.audioDir, filename);
      
      fs.writeFileSync(filePath, audioBuffer);
      
      // We return the local URL relative path and the duration
      return {
        url: `/audio/${filename}`,
        duration_s: response.data.duration_s,
        usage: response.data.usage,
        meta_info: response.data.meta_info
      };

    } catch (error) {
      console.error('Mosi API synthesize error:', error.response?.data || error.message);
      throw new Error(`Synthesize failed: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }
}

module.exports = new MosiService();

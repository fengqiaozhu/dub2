const { systemSettingRepository, aiConfigRepository, ttsConfigRepository } = require('../repositories');
const fishAudioCatalogService = require('../services/fishAudioCatalogService');
const fishAudioService = require('../services/fishAudioService');

const TTS_PROVIDERS = new Set(['mosi', 'fish_audio', 'fish_audio_self_hosted']);

function normalizeOptionalModel(model) {
  if (model === undefined || model === null) return null;
  const normalized = String(model).trim();
  if (normalized.length > 100 || /[\r\n\0]/.test(normalized)) {
    const error = new Error('TTS model must be a single value no longer than 100 characters');
    error.statusCode = 400;
    throw error;
  }
  return normalized || null;
}

class SettingController {
  // System settings API
  async getSystemSettings(req, res) {
    try {
      const settings = await systemSettingRepository.findAll();
      const settingsMap = {};
      for (const s of settings) {
        settingsMap[s.key] = s.value;
      }
      res.json({ data: settingsMap });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async saveSystemSettings(req, res) {
    try {
      const settings = req.body; // Expects an object, e.g., { "FISH_SELF_HOSTED_BASE_URL": "..." }
      if (typeof settings !== 'object' || settings === null) {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }

      for (const [key, value] of Object.entries(settings)) {
        await systemSettingRepository.upsert(key, String(value ?? ''));
      }

      res.json({ message: 'System settings saved successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // AI configs API
  async getAiConfigs(req, res) {
    try {
      const configs = await aiConfigRepository.findAll();
      res.json({ data: configs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createAiConfig(req, res) {
    try {
      const { name, api_url, api_key, model, is_reasoning, is_active } = req.body;
      if (!name || !api_url || !api_key || !model) {
        return res.status(400).json({ error: 'Missing required fields: name, api_url, api_key, model' });
      }

      const id = await aiConfigRepository.create({
        name,
        api_url,
        api_key,
        model,
        is_reasoning: Boolean(is_reasoning),
        is_active: Boolean(is_active)
      });

      if (is_active) {
        await aiConfigRepository.setActive(id);
      }

      res.status(201).json({ message: 'AI configuration created successfully', id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateAiConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, api_url, api_key, model, is_reasoning, is_active } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (api_url !== undefined) updates.api_url = api_url;
      if (api_key !== undefined) updates.api_key = api_key;
      if (model !== undefined) updates.model = model;
      if (is_reasoning !== undefined) updates.is_reasoning = Boolean(is_reasoning);
      if (is_active !== undefined) updates.is_active = Boolean(is_active);

      const success = await aiConfigRepository.update(id, updates);
      if (!success) {
        return res.status(404).json({ error: 'AI configuration not found or no changes made' });
      }

      if (is_active) {
        await aiConfigRepository.setActive(id);
      }

      res.json({ message: 'AI configuration updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteAiConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await aiConfigRepository.delete(id);
      if (!success) {
        return res.status(404).json({ error: 'AI configuration not found' });
      }
      res.json({ message: 'AI configuration deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async setActiveAiConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const config = await aiConfigRepository.findById(id);
      if (!config) {
        return res.status(404).json({ error: 'AI configuration not found' });
      }

      await aiConfigRepository.setActive(id);
      res.json({ message: 'AI configuration activated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // TTS configs API
  async getTtsConfigs(req, res) {
    try {
      const configs = await ttsConfigRepository.findAll();
      res.json({ data: configs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getFishAudioModels(req, res) {
    try {
      const catalog = await fishAudioCatalogService.listModels({
        refresh: req.query.refresh === 'true'
      });
      let recommendedModel = catalog.defaultModel;
      try {
        const account = await fishAudioService.getApiCredit();
        if (account.available && account.recommended_model) {
          recommendedModel = account.recommended_model;
        }
      } catch (error) {
        // Model discovery should still work when no Fish account is configured.
      }
      res.json({ data: { ...catalog, recommendedModel } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createTtsConfig(req, res) {
    try {
      const { name, provider, api_url, api_key, model, is_active } = req.body;
      if (!name || !provider) {
        return res.status(400).json({ error: 'Missing required fields: name, provider' });
      }
      if (!TTS_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'Unsupported TTS provider' });
      }

      const id = await ttsConfigRepository.create({
        name,
        provider,
        api_url: api_url || null,
        api_key: api_key || null,
        model: normalizeOptionalModel(model),
        is_active: Boolean(is_active)
      });

      res.status(201).json({ message: 'TTS configuration created successfully', id });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }

  async updateTtsConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, provider, api_url, api_key, model, is_active } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (provider !== undefined) updates.provider = provider;
      if (api_url !== undefined) updates.api_url = api_url;
      if (api_key !== undefined) updates.api_key = api_key;
      if (model !== undefined) updates.model = normalizeOptionalModel(model);
      if (is_active !== undefined) updates.is_active = Boolean(is_active);
      if (updates.provider !== undefined && !TTS_PROVIDERS.has(updates.provider)) {
        return res.status(400).json({ error: 'Unsupported TTS provider' });
      }

      const success = await ttsConfigRepository.update(id, updates);
      if (!success) {
        return res.status(404).json({ error: 'TTS configuration not found or no changes made' });
      }

      res.json({ message: 'TTS configuration updated successfully' });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }

  async deleteTtsConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await ttsConfigRepository.delete(id);
      if (!success) {
        return res.status(404).json({ error: 'TTS configuration not found' });
      }
      res.json({ message: 'TTS configuration deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async setActiveTtsConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const config = await ttsConfigRepository.findById(id);
      if (!config) {
        return res.status(404).json({ error: 'TTS configuration not found' });
      }

      await ttsConfigRepository.setActive(id);
      res.json({ message: 'TTS configuration activated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new SettingController();

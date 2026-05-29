const { systemSettingRepository, aiConfigRepository, ttsConfigRepository } = require('../repositories');

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

  async createTtsConfig(req, res) {
    try {
      const { name, provider, api_url, api_key, is_active } = req.body;
      if (!name || !provider) {
        return res.status(400).json({ error: 'Missing required fields: name, provider' });
      }

      const id = await ttsConfigRepository.create({
        name,
        provider,
        api_url: api_url || null,
        api_key: api_key || null,
        is_active: Boolean(is_active)
      });

      if (is_active) {
        await ttsConfigRepository.setActive(id, provider);
      }

      res.status(201).json({ message: 'TTS configuration created successfully', id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateTtsConfig(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, provider, api_url, api_key, is_active } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (provider !== undefined) updates.provider = provider;
      if (api_url !== undefined) updates.api_url = api_url;
      if (api_key !== undefined) updates.api_key = api_key;
      if (is_active !== undefined) updates.is_active = Boolean(is_active);

      const success = await ttsConfigRepository.update(id, updates);
      if (!success) {
        return res.status(404).json({ error: 'TTS configuration not found or no changes made' });
      }

      const config = await ttsConfigRepository.findById(id);
      if (config && config.is_active) {
        await ttsConfigRepository.setActive(id, config.provider);
      }

      res.json({ message: 'TTS configuration updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
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

      await ttsConfigRepository.setActive(id, config.provider);
      res.json({ message: 'TTS configuration activated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new SettingController();

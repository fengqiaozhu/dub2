const { ttsConfigRepository } = require('../../repositories');

const PROVIDER_DEFAULTS = {
  mosi: {
    name: 'Mosi 环境变量配置',
    api_url: 'https://studio.mosi.cn',
    model: 'moss-tts'
  },
  fish_audio: {
    name: 'Fish Audio 环境变量配置',
    api_url: null,
    model: null
  },
  fish_audio_self_hosted: {
    name: 'Fish 自托管环境变量配置',
    api_url: null,
    model: 's2-pro'
  }
};

function withSource(config, source = 'database') {
  if (!config) return null;
  return {
    ...config,
    source,
    read_only: source === 'environment'
  };
}

function buildEnvironmentConfig(provider, env = process.env) {
  const defaults = PROVIDER_DEFAULTS[provider];
  if (!defaults) return null;

  if (provider === 'mosi' && env.MOSI_API_KEY) {
    return withSource({
      id: null,
      name: defaults.name,
      provider,
      api_url: env.MOSI_BASE_URL || defaults.api_url,
      api_key: env.MOSI_API_KEY,
      model: defaults.model,
      is_active: true
    }, 'environment');
  }

  if (provider === 'fish_audio' && env.FISH_API_KEY) {
    return withSource({
      id: null,
      name: defaults.name,
      provider,
      api_url: defaults.api_url,
      api_key: env.FISH_API_KEY,
      model: env.FISH_DEFAULT_MODEL || defaults.model,
      is_active: true
    }, 'environment');
  }

  if (provider === 'fish_audio_self_hosted' && env.FISH_SELF_HOSTED_BASE_URL) {
    return withSource({
      id: null,
      name: defaults.name,
      provider,
      api_url: env.FISH_SELF_HOSTED_BASE_URL,
      api_key: null,
      model: defaults.model,
      is_active: true
    }, 'environment');
  }

  return null;
}

function toPublicConfig(config) {
  if (!config) return null;
  return {
    id: config.id === undefined || config.id === null ? null : Number(config.id),
    name: config.name,
    provider: config.provider,
    api_url: config.api_url || null,
    model: config.model || null,
    is_active: Boolean(config.is_active),
    has_api_key: Boolean(config.api_key),
    source: config.source || 'database',
    read_only: Boolean(config.read_only),
    created_at: config.created_at || null,
    updated_at: config.updated_at || null
  };
}

class ProviderConfigService {
  async listStoredConfigs(provider) {
    const rows = await ttsConfigRepository.findByProvider(provider);
    return rows.map((row) => withSource(row));
  }

  async resolveProviderConfig(provider) {
    const storedConfigs = await this.listStoredConfigs(provider);
    const activeConfig = storedConfigs.find((config) => config.is_active);
    if (activeConfig) return activeConfig;

    // Environment variables are a visible compatibility configuration only
    // until the user creates the first database-backed configuration.
    if (storedConfigs.length === 0) {
      return buildEnvironmentConfig(provider);
    }

    return null;
  }

  async buildProviderGroups(capabilities, statuses = []) {
    const statusesByProvider = new Map(statuses.map((status) => [status.provider, status]));
    return Promise.all(capabilities.map(async (provider) => {
      const storedConfigs = await this.listStoredConfigs(provider.provider);
      const environmentConfig = storedConfigs.length === 0
        ? buildEnvironmentConfig(provider.provider)
        : null;
      const configs = environmentConfig ? [environmentConfig] : storedConfigs;
      const activeConfig = configs.find((config) => config.is_active) || null;

      return {
        ...provider,
        configs: configs.map(toPublicConfig),
        active_config: toPublicConfig(activeConfig),
        config_count: configs.length,
        configuration_state: activeConfig
          ? 'active'
          : configs.length > 0
            ? 'inactive'
            : 'unconfigured',
        status: statusesByProvider.get(provider.provider) || null
      };
    }));
  }
}

module.exports = new ProviderConfigService();
module.exports.buildEnvironmentConfig = buildEnvironmentConfig;
module.exports.toPublicConfig = toPublicConfig;

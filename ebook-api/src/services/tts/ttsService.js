const providerRegistry = require('./providerRegistry');
const { normalizeIntent } = require('./ttsIntent');
const { planForProvider } = require('./ttsPlanner');
const {
  ensureProfileSampleHash,
  extractMarker,
  isMarkerMatch
} = require('./voiceProfileIdentity');
const {
  providerVoiceRepository,
  voiceProfileRepository
} = require('../../repositories');

function normalizeStatus(status) {
  const value = String(status || 'UNKNOWN').toUpperCase();
  if (value === 'ACTIVE' || value === 'DONE' || value === 'TRAINED') return 'DONE';
  if (value === 'PENDING' || value === 'RUNNING' || value === 'TRAINING' || value === 'CREATED') return 'PENDING';
  if (value === 'FAILED') return 'FAILED';
  return value;
}

function matchesStatus(voice, status) {
  if (!status) return true;
  return normalizeStatus(voice.status) === normalizeStatus(status);
}

class TtsService {
  getProviders() {
    return providerRegistry.list();
  }

  async getProviderStatuses() {
    const providers = providerRegistry.list();
    const statuses = await Promise.all(providers.map(async (provider) => {
      const providerInstance = providerRegistry.get(provider.provider);
      if (typeof providerInstance.getStatus === 'function') {
        const status = await providerInstance.getStatus();
        return {
          provider: provider.provider,
          synthesis_available: status.available,
          reason: status.reason,
          configured: status.configured,
          status: status.status,
          billing: status.billing || null
        };
      }

      if (provider.provider !== 'fish_audio') {
        return {
          provider: provider.provider,
          synthesis_available: true,
          reason: null
        };
      }

      const fishAudioService = require('../fishAudioService');
      const credit = await fishAudioService.getApiCredit();
      return {
        provider: provider.provider,
        synthesis_available: credit.available,
        reason: credit.reason,
        credit: credit.credit,
        package: credit.package,
        recommended_model: credit.recommended_model,
        billing: {
          source: 'official_api',
          balance_available: true,
          balance_status: credit.available ? 'available' : 'insufficient',
          credit: credit.credit,
          package: credit.package
        },
        configured: credit.configured,
        status: credit.status
      };
    }));

    return statuses;
  }

  getProvider(providerId = 'mosi') {
    return providerRegistry.get(providerId);
  }

  async listVoices(params = {}) {
    const kind = params.kind || 'all';
    if (kind === 'clone' || kind === 'custom') {
      return this.syncProviderCloneVoices(params);
    }

    const provider = this.getProvider(params.provider || 'mosi');
    return provider.listVoices(params);
  }

  async syncProviderCloneVoices(params = {}) {
    const providerId = params.provider || 'mosi';
    const provider = this.getProvider(providerId);
    const pageSize = 100;
    let offset = 0;
    let total = null;
    const remoteVoices = [];

    for (let page = 0; page < 50; page += 1) {
      const result = await provider.listVoices({
        kind: 'clone',
        limit: pageSize,
        offset
      });
      const voices = result.voices || [];
      remoteVoices.push(...voices);

      const numericTotal = Number(result.total);
      total = Number.isFinite(numericTotal) ? numericTotal : total;
      offset += voices.length;

      const hasMore = total !== null ? offset < total : voices.length >= pageSize;
      if (!hasMore || voices.length === 0) break;
    }

    const confirmedVoiceIds = [];
    const syncedVoices = await Promise.all(remoteVoices.map(async (voice) => {
      const providerVoiceId = voice.provider_voice_id || voice.voice_id || voice.voiceId || voice.id;
      const existingProviderVoice = providerVoiceId
        ? await providerVoiceRepository.findByProviderVoiceId(providerId, providerVoiceId)
        : null;
      const markerInfo = extractMarker(voice) || extractMarker(existingProviderVoice?.provider_meta);
      const profile = markerInfo ? await voiceProfileRepository.findById(markerInfo.voice_profile_id) : null;
      if (profile) {
        await ensureProfileSampleHash(profile, voiceProfileRepository);
      }

      if (providerVoiceId && profile && isMarkerMatch(profile, markerInfo)) {
        confirmedVoiceIds.push(providerVoiceId);
        await providerVoiceRepository.upsert({
          voice_profile_id: profile.id,
          provider: providerId,
          provider_voice_id: providerVoiceId,
          provider_model: voice.provider_model || voice.model,
          kind: 'clone',
          status: normalizeStatus(voice.status),
          capabilities_snapshot: voice.capabilities_snapshot,
          provider_meta: {
            marker: markerInfo.marker,
            remote: voice.raw || voice
          }
        });

        return {
          ...voice,
          voice_profile_id: profile.id,
          voice_profile_name: profile.name,
          name: profile.name || voice.name,
          marker: markerInfo.marker,
          projection_confirmed: true,
          status: normalizeStatus(voice.status)
        };
      }

      return {
        ...voice,
        projection_confirmed: false,
        status: normalizeStatus(voice.status)
      };
    }));

    await providerVoiceRepository.deleteMissingForProvider(providerId, confirmedVoiceIds);

    const filtered = syncedVoices.filter((voice) => matchesStatus(voice, params.status));
    const limit = Math.max(1, parseInt(params.limit, 10) || 50);
    const resultOffset = Math.max(0, parseInt(params.offset, 10) || 0);

    return {
      provider: providerId,
      kind: 'clone',
      voices: filtered.slice(resultOffset, resultOffset + limit),
      total: filtered.length,
      page_size: limit,
      offset: resultOffset,
      synced: {
        confirmed: confirmedVoiceIds.length,
        deleted_missing: true
      }
    };
  }

  async cloneVoice(params = {}) {
    const provider = this.getProvider(params.provider || 'mosi');
    return provider.cloneVoice(params);
  }

  async deleteVoice({ provider, voiceId }) {
    const providerInstance = this.getProvider(provider);
    if (typeof providerInstance.deleteVoice !== 'function') {
      return { skipped: true, reason: `${provider} does not support remote voice deletion` };
    }
    return providerInstance.deleteVoice(voiceId);
  }

  async synthesize(params = {}) {
    const providerId = params.provider || 'mosi';
    let requestParams = params;
    if (providerId === 'fish_audio') {
      const fishAudioService = require('../fishAudioService');
      const credit = await fishAudioService.getApiCredit();
      if (!credit.available) {
        const error = new Error(credit.reason || 'Fish Audio API credit is insufficient');
        error.statusCode = 402;
        error.provider = providerId;
        error.credit = credit.credit;
        throw error;
      }
      requestParams = {
        ...params,
        model: params.model || await fishAudioService.getConfiguredModel({ accountStatus: credit })
      };
    }

    const provider = this.getProvider(providerId);
    const intent = normalizeIntent(requestParams);
    const plan = planForProvider(provider, { ...requestParams, intent });
    const result = await provider.synthesize({
      text: requestParams.text,
      voiceId: requestParams.voiceId || requestParams.voice_id,
      model: plan.model,
      options: {
        ...plan.providerOptions,
        storage: requestParams.options?.storage
      }
    });

    return {
      ...result,
      provider: providerId,
      model: plan.model,
      applied_controls: plan.appliedControls
    };
  }
}

module.exports = new TtsService();

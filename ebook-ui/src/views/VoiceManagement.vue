<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import request, { toMediaUrl } from '@/api/request';
import AudioTrack from '@/components/common/AudioTrack.vue';
import { fetchTtsVoicePage, fetchVoiceProfilePage } from '@/api/voices';

type TabId = 'assets' | 'providerVoices' | 'jobs' | 'capabilities';
type Status = 'ACTIVE' | 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'UNKNOWN';

interface ProviderModel {
  id: string;
  label?: string;
  capabilities: Record<string, any>;
  limits?: Record<string, any>;
}

interface TtsProvider {
  provider: string;
  displayName: string;
  defaultModel: string;
  voiceKinds: string[];
  models: ProviderModel[];
  configs: TtsProviderConfig[];
  active_config: TtsProviderConfig | null;
  config_count: number;
  configuration_state: 'active' | 'inactive' | 'unconfigured';
  status?: ProviderStatus | null;
}

interface TtsProviderConfig {
  id: number | null;
  name: string;
  provider: string;
  api_url?: string | null;
  model?: string | null;
  is_active: boolean;
  has_api_key: boolean;
  source: 'database' | 'environment';
  read_only: boolean;
}

interface VoiceProfile {
  id: number;
  name: string;
  description?: string;
  sample_text?: string;
  sample_audio_url?: string;
  language?: string;
  consent_status?: string;
  provider_voice_count?: number;
  provider_statuses?: string;
  created_at?: string;
  updated_at?: string;
}

interface ProviderVoice {
  id?: string | number;
  provider: string;
  provider_voice_id: string;
  provider_model?: string;
  kind: 'system' | 'clone' | 'custom' | 'imported';
  status?: Status | string;
  name?: string;
  displayName?: string;
  language?: string;
  gender?: string;
  previewAudioUrl?: string;
  sample_audio_url?: string;
  voice_profile_id?: number | null;
  voice_profile_name?: string;
  projection_confirmed?: boolean;
  capabilities_snapshot?: any;
  raw?: any;
}

interface VoiceFavorite {
  favorite_key: string;
  provider?: string | null;
  provider_voice_id?: string | null;
  voice_source: 'system' | 'clone';
  voice_profile_id?: number | null;
}

interface ProviderStatus {
  provider: string;
  synthesis_available: boolean;
  reason?: string | null;
  configured?: boolean;
  credit?: number | null;
  package?: {
    type?: string | null;
    total?: number | null;
    balance?: number | null;
    extra_balance?: number | null;
  } | null;
  recommended_model?: string | null;
  billing?: {
    source?: 'official_api' | 'local_usage' | string;
    balance_available?: boolean;
    balance_status?: 'available' | 'insufficient' | 'unknown' | string;
    note?: string | null;
    credit?: number | null;
    package?: ProviderStatus['package'];
    request_count?: number;
    total_credit_cost?: number;
    last_credit_cost?: number | null;
    last_used_at?: string | null;
    last_error_code?: string | null;
    last_error_message?: string | null;
    last_error_at?: string | null;
  } | null;
}

interface PageState {
  offset: number;
  hasMore: boolean;
  loading: boolean;
}

interface Job {
  id: string;
  job_name: string;
  type: string;
  target_id?: string;
  status: Status;
  progress: number;
  result?: any;
  error?: string;
  created_at?: string;
  updated_at?: string;
}

type DetailItem =
  | { type: 'profile'; data: VoiceProfile }
  | { type: 'providerVoice'; data: ProviderVoice }
  | { type: 'job'; data: Job }
  | null;

const activeTab = ref<TabId>('assets');
const query = ref('');
const selectedProvider = ref('all');
const selectedStatus = ref('all');
const providers = ref<TtsProvider[]>([]);
const providerStatuses = ref<Record<string, ProviderStatus>>({});
const voiceProfiles = ref<VoiceProfile[]>([]);
const platformVoices = ref<ProviderVoice[]>([]);
const favorites = ref<VoiceFavorite[]>([]);
const cloneJobs = ref<Job[]>([]);
const loading = ref(false);
const balanceLoading = ref(false);
const activatingConfigId = ref<number | null>(null);
const configActionError = ref('');
const loadingMoreProfiles = ref(false);
const loadingMoreProviderVoices = ref(false);
const detailItem = ref<DetailItem>(null);
const playingId = ref<string | null>(null);
const deletingProfileId = ref<number | null>(null);
const uploadVisible = ref(false);
const uploadSaving = ref(false);
const cloningProfileIds = ref<Set<number>>(new Set());
const selectedProfileIds = ref<Set<number>>(new Set());
const cloneTargetProvider = ref('mosi');
const clonePickerVisible = ref(false);
const clonePickerProfiles = ref<VoiceProfile[]>([]);
const clonePickerProvider = ref('mosi');
const cloneSubmitting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const uploadForm = ref({
  name: '',
  language: 'zh-CN',
  consent_status: 'confirmed',
  description: '',
  sample_text: '',
  provider: 'mosi',
  cloneToProvider: false,
  file: null as File | null,
});
const profilePageState = ref<PageState>({ offset: 0, hasMore: true, loading: false });
const providerVoicePageStates = ref<Record<string, PageState>>({});
const VOICE_PAGE_LIMIT = 60;
const cloneJobPollers = new Map<string, number>();
let profileReloadToken = 0;
let providerVoiceReloadToken = 0;

const providerOptions = computed(() => [
  { value: 'all', label: '全部 Provider' },
  ...providers.value.map((p) => ({ value: p.provider, label: p.displayName || p.provider })),
]);

const cloneProviderOptions = computed(() => (
  providers.value
    .filter((provider) => (
      provider.active_config
      && isProviderSynthAvailable(provider.provider)
      && provider.models.some((model) => model.capabilities?.cloneVoice)
    ))
    .map((provider) => ({ value: provider.provider, label: provider.displayName || provider.provider }))
));

const activeCloneProvider = computed(() => {
  const available = cloneProviderOptions.value;
  if (available.some((provider) => provider.value === cloneTargetProvider.value)) {
    return cloneTargetProvider.value;
  }
  return available[0]?.value || 'mosi';
});

const selectedCloneProviderLabel = computed(() => (
  cloneProviderOptions.value.find((provider) => provider.value === clonePickerProvider.value)?.label
  || clonePickerProvider.value
));

const providerSummary = computed(() => {
  const configured = providers.value.filter((provider) => provider.active_config).length;
  const voices = platformVoices.value.length;
  return `VOICE LIBRARY // ${voiceProfiles.value.length} ASSETS // ${voices} PROVIDER VOICES // ${configured}/${providers.value.length} ACTIVE PROVIDERS`;
});

const filteredProfiles = computed(() => {
  const q = query.value.trim().toLowerCase();
  const matched = voiceProfiles.value.filter((profile) => {
    if (!q) return true;
    return [profile.name, profile.sample_text, profile.language, profile.provider_statuses]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
  return sortFavoritesFirst(matched, favoriteKeyForProfile);
});

const filteredProviderVoices = computed(() => {
  const q = query.value.trim().toLowerCase();
  const matched = platformVoices.value.filter((voice) => {
    const providerMatch = selectedProvider.value === 'all' || voice.provider === selectedProvider.value;
    const statusMatch = selectedStatus.value === 'all' || normalizeStatus(voice.status) === selectedStatus.value;
    const textMatch = !q || [
      voice.displayName,
      voice.name,
      voice.provider_voice_id,
      voice.provider,
      voice.kind,
      voice.language,
      voice.voice_profile_name,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    return providerMatch && statusMatch && textMatch;
  });
  return sortFavoritesFirst(matched, favoriteKeyForProviderVoice);
});

const capabilityRows = computed(() => {
  return providers.value.flatMap((provider) => provider.models.map((model) => ({
    provider: provider.displayName || provider.provider,
    model: model.label || model.id,
    capabilities: model.capabilities || {},
  })));
});

const normalizeStatus = (status?: string | null): Status => {
  const value = String(status || 'UNKNOWN').toUpperCase();
  if (value === 'ACTIVE' || value === 'DONE') return 'ACTIVE';
  if (value === 'PENDING' || value === 'RUNNING') return 'PENDING';
  if (value === 'FAILED') return 'FAILED';
  return 'UNKNOWN';
};

const statusLabel = (status?: string | null) => {
  const normalized = normalizeStatus(status);
  const labels: Record<Status, string> = {
    ACTIVE: '可用',
    PENDING: '处理中',
    RUNNING: '处理中',
    DONE: '完成',
    FAILED: '失败',
    UNKNOWN: '未知',
  };
  return labels[normalized] || labels.UNKNOWN;
};

const statusClass = (status?: string | null) => `status-${normalizeStatus(status).toLowerCase()}`;

const consentLabel = (status?: string) => {
  const labels: Record<string, string> = {
    confirmed: '授权已确认',
    unknown: '授权未确认',
    restricted: '受限使用',
  };
  return labels[status || 'unknown'] || status || '授权未确认';
};

const qualityLabel = (profile: VoiceProfile) => {
  if (!profile.sample_audio_url) return '缺少音频';
  if (!profile.sample_text) return '缺少文本';
  if ((profile.sample_text || '').length < 20) return '文本偏短';
  return '样本完整';
};

const providerStatusChips = (profile: VoiceProfile) => {
  if (!profile.provider_statuses) return [];
  return profile.provider_statuses.split(',').filter(Boolean).map((item) => {
    const [provider, status] = item.split(':');
    return { provider, status };
  });
};

const profileHasProviderClone = (profile: VoiceProfile, provider: string) => (
  providerStatusChips(profile).some((chip) => (
    chip.provider === provider
    && ['ACTIVE', 'DONE', 'PENDING', 'RUNNING'].includes(String(chip.status || '').toUpperCase())
  ))
);

const clonePickerAlreadyClonedProfiles = computed(() => (
  clonePickerProfiles.value.filter((profile) => profileHasProviderClone(profile, clonePickerProvider.value))
));

const clonePickerCloneableProfiles = computed(() => (
  clonePickerProfiles.value.filter((profile) => (
    profile.sample_audio_url && !profileHasProviderClone(profile, clonePickerProvider.value)
  ))
));

const voiceName = (voice: ProviderVoice) => (
  voice.displayName || voice.name || voice.raw?.voiceName || voice.raw?.name || voice.provider_voice_id
);

const voiceAudioSrc = (voice: ProviderVoice) => {
  const src = voice.previewAudioUrl || voice.sample_audio_url || voice.raw?.previewAudioUrl || voice.raw?.audioSampleUrl || '';
  return src.startsWith('/') ? toMediaUrl(src) : src;
};

const profileAudioSrc = (profile: VoiceProfile) => (
  profile.sample_audio_url ? toMediaUrl(profile.sample_audio_url) : ''
);

const profileKey = (profileId: string | number) => `profile:${profileId}`;
const providerVoiceKey = (provider: string, source: string, providerVoiceId: string) => `${provider || 'mosi'}:${source || 'clone'}:${providerVoiceId}`;
const favoriteKeyForProfile = (profile: VoiceProfile) => profileKey(profile.id);
const favoriteKeyForProviderVoice = (voice: ProviderVoice) => providerVoiceKey(voice.provider, voice.kind, voice.provider_voice_id);
const favoriteKeys = computed(() => new Set(favorites.value.map((favorite) => favorite.favorite_key)));
const isFavoriteKey = (key: string) => favoriteKeys.value.has(key);
const providerStatusFor = (provider: string) => providerStatuses.value[provider];
const providerFor = (provider: string) => providers.value.find((item) => item.provider === provider);
const isProviderSynthAvailable = (provider: string) => (
  Boolean(providerFor(provider)?.active_config)
  && providerStatusFor(provider)?.synthesis_available !== false
);
const providerUnavailableReason = (provider: string) => {
  const providerGroup = providerFor(provider);
  if (!providerGroup?.configs?.length) return '尚未创建配置';
  if (!providerGroup.active_config) return '已有配置，但尚未激活';
  return providerStatusFor(provider)?.reason || '该平台当前不可配音';
};
const hasProviderAccountWarning = (provider: string) => (
  providerStatusFor(provider)?.billing?.balance_status === 'insufficient'
);
const providerStatusLabel = (provider: string) => {
  if (!providerFor(provider)?.active_config) return '未激活配置';
  if (!isProviderSynthAvailable(provider)) return '不可配音';
  if (hasProviderAccountWarning(provider)) return '余额不足 · 可重试';
  return '配置已生效';
};
const isProfileSelected = (profile: VoiceProfile) => selectedProfileIds.value.has(profile.id);
const isProfileCloning = (profile: VoiceProfile) => cloningProfileIds.value.has(profile.id);
const selectableFilteredProfiles = computed(() => filteredProfiles.value.filter((profile) => Boolean(profile.sample_audio_url)));
const allFilteredProfilesSelected = computed(() => (
  selectableFilteredProfiles.value.length > 0
  && selectableFilteredProfiles.value.every((profile) => selectedProfileIds.value.has(profile.id))
));

const sortFavoritesFirst = <T,>(items: T[], getKey: (item: T) => string) => (
  [...items].sort((a, b) => Number(isFavoriteKey(getKey(b))) - Number(isFavoriteKey(getKey(a))))
);

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatCredit = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(number);
};

const formatUsageTime = (value?: string | null) => {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
};

const fishPackageFor = (provider: string) => {
  const status = providerStatusFor(provider);
  return status?.billing?.package || status?.package || null;
};

const fishCreditFor = (provider: string) => {
  const status = providerStatusFor(provider);
  return status?.billing?.credit ?? status?.credit ?? null;
};

const providerAccountTitle = (provider: string) => {
  const status = providerStatusFor(provider);
  if (provider === 'fish_audio') {
    return status?.billing?.balance_available
      ? '余额来自 Fish Audio 官方账户接口'
      : status?.reason || '尚未取得 Fish Audio 余额';
  }
  if (provider === 'mosi') {
    return status?.billing?.note || 'Mosi 官方未公开账户余额查询接口';
  }
  return status?.reason || '该平台暂无余额信息';
};

const mapLiveVoice = (voice: any, kind: 'system' | 'clone'): ProviderVoice => ({
  id: `${voice.provider || 'mosi'}:${voice.provider_voice_id || voice.voice_id || voice.voiceId || voice.id}`,
  provider: voice.provider || 'mosi',
  provider_voice_id: voice.provider_voice_id || voice.voice_id || voice.voiceId || voice.id,
  kind,
  status: voice.status || (kind === 'system' ? 'ACTIVE' : 'UNKNOWN'),
  name: voice.name || voice.voiceName,
  displayName: voice.name || voice.voiceName,
  language: voice.language,
  gender: voice.gender,
  previewAudioUrl: voice.previewAudioUrl,
  raw: voice.raw || voice,
});

const providerKindKey = (provider: string, kind: 'system' | 'clone') => `${provider}:${kind}`;

const currentProviderIds = () => (
  providers.value
    .filter((provider) => provider.active_config)
    .map((provider) => provider.provider)
    .filter(Boolean)
);

const fetchProviders = async () => {
  const res: any = await request.get('/tts/providers');
  providers.value = res.data || [];
  providerStatuses.value = Object.fromEntries(
    providers.value
      .filter((provider) => provider.status)
      .map((provider) => [provider.provider, provider.status as ProviderStatus])
  );
};

const refreshProviderRuntime = async () => {
  if (balanceLoading.value) return;
  balanceLoading.value = true;
  configActionError.value = '';
  try {
    await fetchProviders();
    await fetchPlatformVoices();
  } catch (error) {
    console.error('Failed to refresh provider runtime:', error);
    configActionError.value = '刷新平台配置失败，请检查 API 服务状态';
  } finally {
    balanceLoading.value = false;
  }
};

const activateProviderConfig = async (provider: TtsProvider, config: TtsProviderConfig) => {
  if (config.id === null || config.read_only || config.is_active || activatingConfigId.value !== null) return;
  activatingConfigId.value = config.id;
  configActionError.value = '';
  try {
    await request.post(`/settings/tts/${config.id}/active`);
    selectedProvider.value = provider.provider;
    await fetchProviders();
    await fetchPlatformVoices();
  } catch (error: any) {
    console.error('Failed to activate TTS configuration:', error);
    configActionError.value = error?.response?.data?.error || '激活配置失败';
  } finally {
    activatingConfigId.value = null;
  }
};

const fetchVoiceProfiles = async () => {
  const token = ++profileReloadToken;
  profilePageState.value = { offset: 0, hasMore: true, loading: true };
  loadingMoreProfiles.value = true;
  try {
    const page = await fetchVoiceProfilePage({ limit: VOICE_PAGE_LIMIT, offset: 0 });
    if (token !== profileReloadToken) return;
    voiceProfiles.value = page.profiles;
    profilePageState.value = {
      offset: page.nextOffset,
      hasMore: page.hasMore,
      loading: false,
    };
  } catch (error) {
    if (token !== profileReloadToken) return;
    console.error('Failed to fetch voice profiles:', error);
    voiceProfiles.value = [];
    profilePageState.value = { offset: 0, hasMore: false, loading: false };
  } finally {
    if (token === profileReloadToken) {
      loadingMoreProfiles.value = false;
    }
  }
};

const fetchFavorites = async () => {
  try {
    const res: any = await request.get('/tts/voice-favorites');
    favorites.value = res.data || [];
  } catch (error) {
    console.error('Failed to fetch voice favorites:', error);
    favorites.value = [];
  }
};

const fetchPlatformVoices = async () => {
  const token = ++providerVoiceReloadToken;
  const nextStates: Record<string, PageState> = {};
  currentProviderIds().forEach((provider) => {
    (['system', 'clone'] as const).forEach((kind) => {
      nextStates[providerKindKey(provider, kind)] = { offset: 0, hasMore: true, loading: true };
    });
  });
  providerVoicePageStates.value = nextStates;
  loadingMoreProviderVoices.value = true;

  try {
    const pages = await Promise.all(currentProviderIds().flatMap((provider) => (
      (['system', 'clone'] as const).map(async (kind) => {
        try {
          const page = await fetchTtsVoicePage({ provider, kind, limit: VOICE_PAGE_LIMIT, offset: 0 });
          return { provider, kind, page };
        } catch (error) {
          console.warn(`Failed to fetch ${provider} ${kind} voices:`, error);
          return { provider, kind, page: { voices: [], nextOffset: 0, hasMore: false } };
        }
      })
    )));
    if (token !== providerVoiceReloadToken) return;
    pages.forEach(({ provider, kind, page }) => {
      providerVoicePageStates.value[providerKindKey(provider, kind)] = {
        offset: page.nextOffset,
        hasMore: page.hasMore,
        loading: false,
      };
    });
    platformVoices.value = pages.flatMap(({ provider, kind, page }) => (
      page.voices.map((voice: any) => mapLiveVoice({ ...voice, provider }, kind))
    ));
  } finally {
    if (token === providerVoiceReloadToken) {
      loadingMoreProviderVoices.value = false;
    }
  }
};

const loadMoreVoiceProfiles = async () => {
  const state = profilePageState.value;
  if (state.loading || !state.hasMore) return;
  state.loading = true;
  loadingMoreProfiles.value = true;
  try {
    const page = await fetchVoiceProfilePage({ limit: VOICE_PAGE_LIMIT, offset: state.offset });
    voiceProfiles.value.push(...page.profiles);
    state.offset = page.nextOffset;
    state.hasMore = page.hasMore;
  } finally {
    state.loading = false;
    loadingMoreProfiles.value = false;
  }
};

const loadMoreProviderVoices = async () => {
  if (loadingMoreProviderVoices.value) return;
  const targets = currentProviderIds().flatMap((provider) => (
    (['system', 'clone'] as const).map((kind) => ({ provider, kind }))
  )).filter(({ provider, kind }) => {
    const state = providerVoicePageStates.value[providerKindKey(provider, kind)];
    return state?.hasMore && !state.loading;
  });

  if (targets.length === 0) return;
  loadingMoreProviderVoices.value = true;
  try {
    const pages = await Promise.all(targets.map(async ({ provider, kind }) => {
      const key = providerKindKey(provider, kind);
      const state = providerVoicePageStates.value[key];
      state.loading = true;
      try {
        const page = await fetchTtsVoicePage({
          provider,
          kind,
          limit: VOICE_PAGE_LIMIT,
          offset: state.offset,
        });
        state.offset = page.nextOffset;
        state.hasMore = page.hasMore;
        return page.voices.map((voice: any) => mapLiveVoice({ ...voice, provider }, kind));
      } catch (error) {
        console.warn(`Failed to fetch ${provider} ${kind} voices:`, error);
        state.hasMore = false;
        return [];
      } finally {
        state.loading = false;
      }
    }));
    platformVoices.value.push(...pages.flat());
  } finally {
    loadingMoreProviderVoices.value = false;
  }
};

const handleDataPanelScroll = (event: Event) => {
  const el = event.currentTarget as HTMLElement;
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;
  if (activeTab.value === 'assets') loadMoreVoiceProfiles();
  if (activeTab.value === 'providerVoices') loadMoreProviderVoices();
};

const toggleProfileFavorite = async (profile: VoiceProfile) => {
  const key = favoriteKeyForProfile(profile);
  try {
    if (isFavoriteKey(key)) {
      await request.delete('/tts/voice-favorites', { params: { voice_profile_id: profile.id } });
      favorites.value = favorites.value.filter((favorite) => favorite.favorite_key !== key);
      return;
    }

    const res: any = await request.post('/tts/voice-favorites', {
      voice_profile_id: profile.id,
      voice_source: 'clone',
      name_snapshot: profile.name,
    });
    favorites.value = [res.data, ...favorites.value.filter((favorite) => favorite.favorite_key !== key)];
  } catch (error) {
    console.error('Failed to toggle voice favorite:', error);
  }
};

const deleteProfile = async (profile: VoiceProfile) => {
  if (deletingProfileId.value) return;
  const confirmed = window.confirm(`删除音色资产「${profile.name}」？关联的平台音色也会一并删除。`);
  if (!confirmed) return;

  deletingProfileId.value = profile.id;
  try {
    await request.delete(`/tts/voice-profiles/${profile.id}`);
    voiceProfiles.value = voiceProfiles.value.filter((item) => item.id !== profile.id);
    platformVoices.value = platformVoices.value.filter((voice) => voice.voice_profile_id !== profile.id);
    favorites.value = favorites.value.filter((favorite) => favorite.voice_profile_id !== profile.id);
    if (detailItem.value?.type === 'profile' && detailItem.value.data.id === profile.id) {
      detailItem.value = null;
    }
    if (detailItem.value?.type === 'providerVoice' && detailItem.value.data.voice_profile_id === profile.id) {
      detailItem.value = null;
    }
    playingId.value = null;
    await Promise.all([fetchVoiceProfiles(), fetchPlatformVoices(), fetchFavorites()]);
  } catch (error) {
    console.error('Failed to delete voice profile:', error);
  } finally {
    deletingProfileId.value = null;
  }
};

const toggleProfileSelection = (profile: VoiceProfile) => {
  const next = new Set(selectedProfileIds.value);
  if (next.has(profile.id)) {
    next.delete(profile.id);
  } else {
    next.add(profile.id);
  }
  selectedProfileIds.value = next;
};

const toggleAllFilteredProfiles = () => {
  const next = new Set(selectedProfileIds.value);
  if (allFilteredProfilesSelected.value) {
    selectableFilteredProfiles.value.forEach((profile) => next.delete(profile.id));
  } else {
    selectableFilteredProfiles.value.forEach((profile) => next.add(profile.id));
  }
  selectedProfileIds.value = next;
};

const setProfilesCloning = (profiles: VoiceProfile[], cloning: boolean) => {
  const next = new Set(cloningProfileIds.value);
  profiles.forEach((profile) => {
    if (cloning) next.add(profile.id);
    else next.delete(profile.id);
  });
  cloningProfileIds.value = next;
};

const upsertCloneJob = (job: Job) => {
  cloneJobs.value = [
    job,
    ...cloneJobs.value.filter((item) => item.id !== job.id),
  ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (detailItem.value?.type === 'job' && detailItem.value.data.id === job.id) {
    detailItem.value = { type: 'job', data: job };
  }
};

const stopCloneJobPolling = (jobId: string) => {
  const interval = cloneJobPollers.get(jobId);
  if (!interval) return;
  window.clearInterval(interval);
  cloneJobPollers.delete(jobId);
};

const trackCloneJob = (jobId: string, profileId?: number) => {
  if (!jobId || cloneJobPollers.has(jobId)) return;

  const poll = async () => {
    try {
      const response: any = await request.get(`/jobs/${jobId}`);
      const job: Job = response?.data || response;
      upsertCloneJob(job);
      if (job.status === 'DONE' || job.status === 'FAILED') {
        stopCloneJobPolling(jobId);
        if (profileId) {
          const done = new Set(cloningProfileIds.value);
          done.delete(profileId);
          cloningProfileIds.value = done;
        }
        if (job.status === 'DONE') {
          await Promise.all([fetchVoiceProfiles(), fetchPlatformVoices(), fetchFavorites()]);
        }
      }
    } catch (error) {
      console.error('Failed to poll clone job:', error);
      stopCloneJobPolling(jobId);
    }
  };

  poll();
  cloneJobPollers.set(jobId, window.setInterval(poll, 1800));
};

const openClonePicker = (profiles: VoiceProfile[]) => {
  const candidates = profiles.filter((profile) => profile.sample_audio_url);
  if (candidates.length === 0 || cloneProviderOptions.value.length === 0) return;
  clonePickerProfiles.value = candidates;
  clonePickerProvider.value = activeCloneProvider.value;
  cloneTargetProvider.value = activeCloneProvider.value;
  clonePickerVisible.value = true;
};

const closeClonePicker = () => {
  if (cloneSubmitting.value) return;
  clonePickerVisible.value = false;
  clonePickerProfiles.value = [];
};

const submitClonePicker = async () => {
  if (cloneSubmitting.value) return;
  const provider = clonePickerProvider.value;
  const targets = clonePickerCloneableProfiles.value;
  if (targets.length === 0) {
    closeClonePicker();
    return;
  }

  cloneSubmitting.value = true;
  setProfilesCloning(targets, true);
  activeTab.value = 'jobs';
  try {
    const results = await Promise.all(targets.map(async (profile) => {
      const response: any = await request.post(`/tts/voice-profiles/${profile.id}/clone`, { provider });
      return { profile, data: response?.data || response };
    }));

    results.forEach(({ profile, data }) => {
      if (data?.jobId) {
        const pendingJob: Job = {
          id: data.jobId,
          job_name: `tts_clone-${data.jobId}`,
          type: 'tts_clone',
          target_id: String(profile.id),
          status: 'PENDING',
          progress: 0,
        };
        upsertCloneJob(pendingJob);
        trackCloneJob(data.jobId, profile.id);
      } else {
        const done = new Set(cloningProfileIds.value);
        done.delete(profile.id);
        cloningProfileIds.value = done;
      }
    });

    selectedProfileIds.value = new Set([...selectedProfileIds.value].filter((id) => (
      !clonePickerProfiles.value.some((profile) => profile.id === id)
    )));
    clonePickerVisible.value = false;
    clonePickerProfiles.value = [];
    await Promise.all([fetchVoiceProfiles(), fetchPlatformVoices(), fetchCloneJobs()]);
  } catch (error) {
    console.error('Failed to clone voice profile:', error);
    setProfilesCloning(targets, false);
  } finally {
    cloneSubmitting.value = false;
  }
};

const cloneProfileToProvider = (profile: VoiceProfile) => {
  if (isProfileCloning(profile)) return;
  openClonePicker([profile]);
};

const cloneSelectedProfiles = () => {
  const selected = voiceProfiles.value.filter((profile) => selectedProfileIds.value.has(profile.id));
  openClonePicker(selected);
};

const toggleProviderVoiceFavorite = async (voice: ProviderVoice) => {
  const key = favoriteKeyForProviderVoice(voice);
  try {
    if (isFavoriteKey(key)) {
      await request.delete('/tts/voice-favorites', {
        params: {
          provider: voice.provider,
          provider_voice_id: voice.provider_voice_id,
          voice_source: voice.kind,
        },
      });
      favorites.value = favorites.value.filter((favorite) => favorite.favorite_key !== key);
      return;
    }

    const res: any = await request.post('/tts/voice-favorites', {
      provider: voice.provider,
      provider_voice_id: voice.provider_voice_id,
      voice_source: voice.kind,
      voice_profile_id: voice.voice_profile_id || null,
      name_snapshot: voiceName(voice),
    });
    favorites.value = [res.data, ...favorites.value.filter((favorite) => favorite.favorite_key !== key)];
  } catch (error) {
    console.error('Failed to toggle voice favorite:', error);
  }
};

const fetchCloneJobs = async () => {
  try {
    const res: any = await request.get('/jobs', { params: { type: 'tts_clone', limit: 30 } });
    cloneJobs.value = res.data || [];
    cloneJobs.value
      .filter((job) => job.status === 'PENDING' || job.status === 'RUNNING')
      .forEach((job) => trackCloneJob(job.id, job.target_id ? Number(job.target_id) : undefined));
  } catch (error) {
    console.error('Failed to fetch clone jobs:', error);
    cloneJobs.value = [];
  }
};

const refreshAll = async () => {
  loading.value = true;
  try {
    await fetchProviders();
    await Promise.all([
      fetchFavorites(),
      fetchVoiceProfiles(),
      fetchPlatformVoices(),
      fetchCloneJobs(),
    ]);
  } finally {
    loading.value = false;
  }
};

const selectProfile = (profile: VoiceProfile) => {
  detailItem.value = { type: 'profile', data: profile };
};

const selectProviderVoice = (voice: ProviderVoice) => {
  detailItem.value = { type: 'providerVoice', data: voice };
};

const selectJob = (job: Job) => {
  detailItem.value = { type: 'job', data: job };
};

const togglePlay = (id: string) => {
  playingId.value = playingId.value === id ? null : id;
};

const openUpload = () => {
  uploadVisible.value = true;
};

const closeUpload = () => {
  uploadVisible.value = false;
  uploadForm.value = {
    name: '',
    language: 'zh-CN',
    consent_status: 'confirmed',
    description: '',
    sample_text: '',
    provider: 'mosi',
    cloneToProvider: false,
    file: null,
  };
  if (fileInput.value) fileInput.value.value = '';
};

const onFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  uploadForm.value.file = target.files?.[0] || null;
  if (!uploadForm.value.name && uploadForm.value.file) {
    uploadForm.value.name = uploadForm.value.file.name.replace(/\.[^.]+$/, '');
  }
};

const submitUpload = async () => {
  if (!uploadForm.value.file || uploadSaving.value) return;
  uploadSaving.value = true;
  try {
    const shouldClone = uploadForm.value.cloneToProvider;
    const formData = new FormData();
    formData.append('file', uploadForm.value.file);
    formData.append('name', uploadForm.value.name || uploadForm.value.file.name);
    formData.append('language', uploadForm.value.language);
    formData.append('consent_status', uploadForm.value.consent_status);
    formData.append('description', uploadForm.value.description);
    formData.append('text', uploadForm.value.sample_text);
    formData.append('provider', uploadForm.value.provider);
    formData.append('clone', String(uploadForm.value.cloneToProvider));

    await request.post('/tts/voice-profiles', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    closeUpload();
    await refreshAll();
    activeTab.value = shouldClone ? 'jobs' : 'assets';
  } catch (error) {
    console.error('Failed to upload voice sample:', error);
  } finally {
    uploadSaving.value = false;
  }
};

onMounted(refreshAll);
onBeforeUnmount(() => {
  [...cloneJobPollers.keys()].forEach(stopCloneJobPolling);
});
</script>

<template>
  <div class="voice-console">
    <div class="console-header">
      <div>
        <h2>音色管理</h2>
        <span class="console-subtitle mono-text">{{ providerSummary }}</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" title="重新读取生效配置、平台状态、余额和音色" :disabled="loading || balanceLoading" @click="refreshProviderRuntime">
          {{ balanceLoading ? '刷新中…' : '刷新配置与音色' }}
        </button>
        <button class="btn btn-outline" disabled title="录制功能待接入">录制样本</button>
        <button class="btn btn-primary" @click="openUpload">上传样本</button>
      </div>
    </div>

    <div class="provider-strip">
      <article
        v-for="provider in providers"
        :key="provider.provider"
        class="provider-group"
        :class="{ active: selectedProvider === provider.provider }"
      >
        <button
          class="provider-group-header"
          @click="selectedProvider = selectedProvider === provider.provider ? 'all' : provider.provider"
        >
          <span>
            <span class="provider-type mono-text">PROVIDER TYPE</span>
            <strong class="provider-name">{{ provider.displayName || provider.provider }}</strong>
            <span class="provider-id mono-text">{{ provider.provider }}</span>
          </span>
          <span
            class="provider-status"
            :class="{
              unavailable: !isProviderSynthAvailable(provider.provider),
              'account-warning': hasProviderAccountWarning(provider.provider),
            }"
            :title="hasProviderAccountWarning(provider.provider)
              ? providerAccountTitle(provider.provider)
              : isProviderSynthAvailable(provider.provider)
                ? '当前配置已生效，后续请求将使用此配置'
                : providerUnavailableReason(provider.provider)"
          >
            {{ providerStatusLabel(provider.provider) }}
          </span>
        </button>

        <div
          v-if="provider.provider === 'fish_audio'"
          class="provider-account"
          :title="providerAccountTitle(provider.provider)"
        >
          <span><b>付费余额</b>{{ formatCredit(fishCreditFor(provider.provider)) }}</span>
          <span>
            <b>{{ fishPackageFor(provider.provider)?.type === 'free' ? '免费套餐' : '套餐余额' }}</b>
            {{ formatCredit(fishPackageFor(provider.provider)?.balance) }}/{{ formatCredit(fishPackageFor(provider.provider)?.total) }}
          </span>
          <span v-if="Number(fishPackageFor(provider.provider)?.extra_balance || 0) > 0">
            <b>额外额度</b>{{ formatCredit(fishPackageFor(provider.provider)?.extra_balance) }}
          </span>
          <span><b>额度建议</b>{{ providerStatusFor(provider.provider)?.recommended_model || '—' }}</span>
        </div>
        <div
          v-else-if="provider.provider === 'mosi'"
          class="provider-account"
          :class="{ warning: providerStatusFor(provider.provider)?.billing?.balance_status === 'insufficient' }"
          :title="providerAccountTitle(provider.provider)"
        >
          <span class="provider-balance-note">
            <b>账户余额</b>
            {{ providerStatusFor(provider.provider)?.billing?.balance_status === 'insufficient' ? '上次请求余额不足' : '官方未开放查询' }}
          </span>
          <span><b>本项目累计</b>{{ formatCredit(providerStatusFor(provider.provider)?.billing?.total_credit_cost) }} credits</span>
          <span><b>最近一次</b>{{ formatCredit(providerStatusFor(provider.provider)?.billing?.last_credit_cost) }} credits</span>
          <span class="provider-usage-time"><b>最近计费</b>{{ formatUsageTime(providerStatusFor(provider.provider)?.billing?.last_used_at) }}</span>
        </div>

        <div class="provider-configs">
          <div class="config-list-heading">
            <span>配置列表</span>
            <span class="mono-text">{{ provider.config_count }} CONFIG{{ provider.config_count === 1 ? '' : 'S' }}</span>
          </div>
          <div
            v-for="config in provider.configs"
            :key="config.id ?? `${provider.provider}-environment`"
            class="provider-config"
            :class="{ active: config.is_active }"
          >
            <span class="config-state-indicator" aria-hidden="true"></span>
            <div class="config-main">
              <div class="config-name-row">
                <strong>{{ config.name }}</strong>
                <span v-if="config.is_active" class="config-badge active">当前生效</span>
                <span v-if="config.source === 'environment'" class="config-badge environment">环境变量</span>
              </div>
              <div class="config-details mono-text">
                <span>
                  MODEL {{ config.model || (config.is_active ? providerStatusFor(provider.provider)?.recommended_model : null) || provider.defaultModel || '平台默认' }}
                </span>
                <span>{{ config.api_url || '官方 API' }}</span>
                <span v-if="provider.provider !== 'fish_audio_self_hosted'">KEY {{ config.has_api_key ? '已配置' : '未配置' }}</span>
              </div>
            </div>
            <button
              v-if="!config.is_active && !config.read_only"
              class="activate-config-btn"
              :disabled="activatingConfigId !== null"
              @click="activateProviderConfig(provider, config)"
            >
              {{ activatingConfigId === config.id ? '切换中…' : '设为生效' }}
            </button>
            <span v-else-if="config.is_active" class="runtime-route mono-text">配音使用此配置</span>
          </div>
          <div v-if="provider.configs.length === 0" class="config-empty-state">
            <span>尚未添加 {{ provider.displayName || provider.provider }} 配置</span>
            <RouterLink to="/settings">前往系统配置</RouterLink>
          </div>
        </div>
      </article>
      <div v-if="providers.length === 0" class="provider-empty mono-text">暂无可用 Provider</div>
    </div>
    <div v-if="configActionError" class="config-action-error">{{ configActionError }}</div>

    <div class="toolbar">
      <div class="tabs">
        <button :class="{ active: activeTab === 'assets' }" @click="activeTab = 'assets'">音色资产</button>
        <button :class="{ active: activeTab === 'providerVoices' }" @click="activeTab = 'providerVoices'">平台音色</button>
        <button :class="{ active: activeTab === 'jobs' }" @click="activeTab = 'jobs'">克隆任务</button>
        <button :class="{ active: activeTab === 'capabilities' }" @click="activeTab = 'capabilities'">能力矩阵</button>
      </div>
      <div class="filters">
        <input v-model="query" class="search-input" placeholder="搜索音色、文本、voice_id" />
        <select v-model="selectedProvider" class="select-input">
          <option v-for="item in providerOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="selectedStatus" class="select-input">
          <option value="all">全部状态</option>
          <option value="ACTIVE">可用</option>
          <option value="PENDING">处理中</option>
          <option value="FAILED">失败</option>
          <option value="UNKNOWN">未知</option>
        </select>
      </div>
    </div>

    <div class="console-body">
      <main class="main-panel">
        <section v-show="activeTab === 'assets'" class="data-panel" @scroll="handleDataPanelScroll">
          <div class="panel-title-row">
            <h3>音色资产</h3>
            <div class="panel-actions">
              <label class="select-all-control">
                <input
                  type="checkbox"
                  :checked="allFilteredProfilesSelected"
                  :disabled="selectableFilteredProfiles.length === 0"
                  @change="toggleAllFilteredProfiles"
                />
                <span>全选</span>
              </label>
              <button
                class="btn btn-outline"
                :disabled="selectedProfileIds.size === 0 || cloneProviderOptions.length === 0"
                @click="cloneSelectedProfiles"
              >
                批量克隆
              </button>
              <span class="panel-count mono-text">{{ filteredProfiles.length }} ITEMS</span>
            </div>
          </div>
          <div v-if="filteredProfiles.length === 0" class="empty-block">
            <strong>还没有自己的音色资产</strong>
            <span>上传样本音频和对应文本，之后可以克隆到不同 TTS 平台。</span>
            <button class="btn btn-primary" @click="openUpload">上传样本</button>
          </div>
          <div
            v-for="profile in filteredProfiles"
            v-else
            :key="profile.id"
            class="asset-row"
            :class="{ selected: detailItem?.type === 'profile' && detailItem.data.id === profile.id }"
            role="button"
            tabindex="0"
            @click="selectProfile(profile)"
            @keydown.enter="selectProfile(profile)"
          >
            <input
              class="row-check"
              type="checkbox"
              :checked="isProfileSelected(profile)"
              @click.stop
              @change.stop="toggleProfileSelection(profile)"
            />
            <div class="voice-avatar">{{ profile.name?.charAt(0) || 'V' }}</div>
            <div class="row-main">
              <div class="row-title">
                <span>{{ profile.name }}</span>
                <span v-if="isFavoriteKey(favoriteKeyForProfile(profile))" class="chip favorite-chip">收藏</span>
                <span class="chip">{{ profile.language || '未设语言' }}</span>
                <span class="chip" :class="{ warning: profile.consent_status !== 'confirmed' }">{{ consentLabel(profile.consent_status) }}</span>
              </div>
              <div class="row-sub">
                <span>{{ qualityLabel(profile) }}</span>
                <span>样本文本 {{ profile.sample_text?.length || 0 }} 字</span>
                <span>更新 {{ formatDate(profile.updated_at || profile.created_at) }}</span>
              </div>
            </div>
            <div class="projection-stack">
              <span
                v-for="chip in providerStatusChips(profile)"
                :key="`${chip.provider}-${chip.status}`"
                class="projection-chip"
                :class="statusClass(chip.status)"
              >
                {{ chip.provider }} {{ statusLabel(chip.status) }}
              </span>
              <span v-if="providerStatusChips(profile).length === 0" class="projection-chip muted">未投影</span>
            </div>
            <button
              class="btn btn-outline"
              :disabled="!profile.sample_audio_url || isProfileCloning(profile) || cloneProviderOptions.length === 0"
              @click.stop="cloneProfileToProvider(profile)"
            >
              {{ isProfileCloning(profile) ? '克隆中' : '克隆' }}
            </button>
            <button
              class="favorite-btn"
              :class="{ active: isFavoriteKey(favoriteKeyForProfile(profile)) }"
              :title="isFavoriteKey(favoriteKeyForProfile(profile)) ? '取消收藏' : '收藏音色'"
              @click.stop="toggleProfileFavorite(profile)"
            >
              <span>{{ isFavoriteKey(favoriteKeyForProfile(profile)) ? '★' : '☆' }}</span>
              <span>{{ isFavoriteKey(favoriteKeyForProfile(profile)) ? '已收藏' : '收藏' }}</span>
            </button>
            <button
              class="icon-delete-btn"
              :disabled="deletingProfileId === profile.id"
              :title="deletingProfileId === profile.id ? '正在删除' : '删除音色资产'"
              aria-label="删除音色资产"
              @click.stop="deleteProfile(profile)"
            >
              <span v-if="deletingProfileId === profile.id" class="delete-spinner" />
              <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          </div>
          <div v-if="loadingMoreProfiles" class="loading-more mono-text">加载更多…</div>
        </section>

        <section v-show="activeTab === 'providerVoices'" class="data-panel" @scroll="handleDataPanelScroll">
          <div class="panel-title-row">
            <h3>平台音色</h3>
            <span class="panel-count mono-text">{{ filteredProviderVoices.length }} ITEMS</span>
          </div>
          <div
            v-for="voice in filteredProviderVoices"
            :key="String(voice.id || voice.provider_voice_id)"
            class="provider-voice-row"
            :class="{ selected: detailItem?.type === 'providerVoice' && detailItem.data.provider_voice_id === voice.provider_voice_id }"
            role="button"
            tabindex="0"
            @click="selectProviderVoice(voice)"
            @keydown.enter="selectProviderVoice(voice)"
          >
            <div class="voice-avatar provider">{{ voiceName(voice).charAt(0) }}</div>
            <div class="row-main">
              <div class="row-title">
                <span>{{ voiceName(voice) }}</span>
                <span v-if="isFavoriteKey(favoriteKeyForProviderVoice(voice))" class="chip favorite-chip">收藏</span>
                <span class="chip">{{ voice.provider }}</span>
                <span v-if="!isProviderSynthAvailable(voice.provider)" class="chip unavailable-chip" :title="providerUnavailableReason(voice.provider)">不可配音</span>
                <span v-if="voice.kind !== 'system' && voice.projection_confirmed === false" class="chip unavailable-chip" title="远端音色未匹配到本地音色资产">未匹配资产</span>
                <span class="chip">{{ voice.kind === 'system' ? '系统预置' : '克隆音色' }}</span>
                <span class="chip" :class="statusClass(voice.status)">{{ statusLabel(voice.status) }}</span>
              </div>
              <div class="row-sub">
                <span class="mono-text">{{ voice.provider_voice_id }}</span>
                <span>{{ voice.language || '未知语言' }}</span>
                <span>{{ voice.voice_profile_name ? `来源：${voice.voice_profile_name}` : '平台原生音色' }}</span>
              </div>
            </div>
            <button
              class="favorite-btn"
              :class="{ active: isFavoriteKey(favoriteKeyForProviderVoice(voice)) }"
              :title="isFavoriteKey(favoriteKeyForProviderVoice(voice)) ? '取消收藏' : '收藏音色'"
              @click.stop="toggleProviderVoiceFavorite(voice)"
            >
              <span>{{ isFavoriteKey(favoriteKeyForProviderVoice(voice)) ? '★' : '☆' }}</span>
              <span>{{ isFavoriteKey(favoriteKeyForProviderVoice(voice)) ? '已收藏' : '收藏' }}</span>
            </button>
            <div class="row-audio" :class="{ 'is-expanded': playingId === String(voice.id || voice.provider_voice_id) }" @click.stop>
              <AudioTrack
                :src="voiceAudioSrc(voice)"
                :active="playingId === String(voice.id || voice.provider_voice_id)"
                :filename="voiceName(voice) + '.wav'"
                :show-download="false"
                :lazy="true"
                @activate="togglePlay(String(voice.id || voice.provider_voice_id))"
                @deactivate="togglePlay(String(voice.id || voice.provider_voice_id))"
              />
            </div>
          </div>
          <div v-if="loadingMoreProviderVoices" class="loading-more mono-text">加载更多…</div>
        </section>

        <section v-show="activeTab === 'jobs'" class="data-panel">
          <div class="panel-title-row">
            <h3>克隆任务</h3>
            <span class="panel-count mono-text">{{ cloneJobs.length }} JOBS</span>
          </div>
          <div v-if="cloneJobs.length === 0" class="empty-block">
            <strong>暂无克隆任务</strong>
            <span>从音色资产发起克隆后，任务进度会显示在这里。</span>
          </div>
          <button
            v-for="job in cloneJobs"
            v-else
            :key="job.id"
            class="job-row"
            :class="{ selected: detailItem?.type === 'job' && detailItem.data.id === job.id }"
            @click="selectJob(job)"
          >
            <div class="job-status" :class="statusClass(job.status)">{{ statusLabel(job.status) }}</div>
            <div class="row-main">
              <div class="row-title">
                <span>{{ job.job_name }}</span>
                <span class="chip mono-text">{{ job.progress || 0 }}%</span>
              </div>
              <div class="row-sub">
                <span>{{ formatDate(job.created_at) }}</span>
                <span v-if="job.error" class="danger">{{ job.error }}</span>
                <span v-else>目标 {{ job.target_id || '新音色资产' }}</span>
              </div>
            </div>
          </button>
        </section>

        <section v-show="activeTab === 'capabilities'" class="data-panel">
          <div class="panel-title-row">
            <h3>能力矩阵</h3>
            <span class="panel-count mono-text">{{ capabilityRows.length }} MODELS</span>
          </div>
          <div class="capability-table">
            <div class="capability-head">
              <span>Provider</span>
              <span>模型</span>
              <span>系统音色</span>
              <span>克隆</span>
              <span>情绪</span>
              <span>语速</span>
              <span>音高</span>
              <span>风格</span>
              <span>时长</span>
              <span>输出</span>
            </div>
            <div v-for="row in capabilityRows" :key="`${row.provider}-${row.model}`" class="capability-row">
              <span>{{ row.provider }}</span>
              <span class="mono-text">{{ row.model }}</span>
              <span>{{ row.capabilities.systemVoices ? '是' : '否' }}</span>
              <span>{{ row.capabilities.cloneVoice ? '是' : '否' }}</span>
              <span>{{ row.capabilities.emotionControl || '否' }}</span>
              <span>{{ row.capabilities.speedControl ? '是' : '否' }}</span>
              <span>{{ row.capabilities.pitchControl ? '是' : '否' }}</span>
              <span>{{ row.capabilities.stylePrompt ? '是' : '否' }}</span>
              <span>{{ row.capabilities.durationControl ? '是' : '否' }}</span>
              <span>{{ (row.capabilities.outputFormats || []).join(', ') || '-' }}</span>
            </div>
          </div>
        </section>
      </main>

      <aside class="detail-panel">
        <template v-if="detailItem?.type === 'profile'">
          <div class="detail-header">
            <span class="detail-kicker">VOICE PROFILE</span>
            <h3>{{ detailItem.data.name }}</h3>
          </div>
          <AudioTrack
            :src="profileAudioSrc(detailItem.data)"
            :active="playingId === `profile-${detailItem.data.id}`"
            :filename="detailItem.data.name + '.wav'"
            @activate="togglePlay(`profile-${detailItem.data.id}`)"
            @deactivate="togglePlay(`profile-${detailItem.data.id}`)"
          />
          <div class="detail-grid">
            <span>语言</span><strong>{{ detailItem.data.language || '-' }}</strong>
            <span>授权</span><strong>{{ consentLabel(detailItem.data.consent_status) }}</strong>
            <span>质量</span><strong>{{ qualityLabel(detailItem.data) }}</strong>
            <span>投影</span><strong>{{ detailItem.data.provider_voice_count || 0 }} 个</strong>
          </div>
          <div class="detail-block">
            <label>样本文本</label>
            <p>{{ detailItem.data.sample_text || '暂无样本文本' }}</p>
          </div>
          <div class="detail-actions">
            <button
              class="btn btn-primary"
              :disabled="!detailItem.data.sample_audio_url || isProfileCloning(detailItem.data) || cloneProviderOptions.length === 0"
              @click="cloneProfileToProvider(detailItem.data)"
            >
              {{ isProfileCloning(detailItem.data) ? '正在克隆' : '克隆' }}
            </button>
          </div>
        </template>

        <template v-else-if="detailItem?.type === 'providerVoice'">
          <div class="detail-header">
            <span class="detail-kicker">PROVIDER VOICE</span>
            <h3>{{ voiceName(detailItem.data) }}</h3>
          </div>
          <AudioTrack
            :src="voiceAudioSrc(detailItem.data)"
            :active="playingId === `provider-${detailItem.data.provider_voice_id}`"
            :filename="voiceName(detailItem.data) + '.wav'"
            @activate="togglePlay(`provider-${detailItem.data.provider_voice_id}`)"
            @deactivate="togglePlay(`provider-${detailItem.data.provider_voice_id}`)"
          />
          <div class="detail-grid">
            <span>Provider</span><strong>{{ detailItem.data.provider }}</strong>
            <span>类型</span><strong>{{ detailItem.data.kind === 'system' ? '系统预置' : '克隆音色' }}</strong>
            <span>状态</span><strong>{{ statusLabel(detailItem.data.status) }}</strong>
            <span>voice_id</span><strong class="mono-text">{{ detailItem.data.provider_voice_id }}</strong>
          </div>
          <div class="detail-block">
            <label>来源资产</label>
            <p>{{ detailItem.data.voice_profile_name || '平台原生音色或尚未关联资产' }}</p>
          </div>
        </template>

        <template v-else-if="detailItem?.type === 'job'">
          <div class="detail-header">
            <span class="detail-kicker">CLONE JOB</span>
            <h3>{{ detailItem.data.job_name }}</h3>
          </div>
          <div class="progress-track"><span :style="{ width: `${detailItem.data.progress || 0}%` }" /></div>
          <div class="detail-grid">
            <span>状态</span><strong>{{ statusLabel(detailItem.data.status) }}</strong>
            <span>进度</span><strong>{{ detailItem.data.progress || 0 }}%</strong>
            <span>创建</span><strong>{{ formatDate(detailItem.data.created_at) }}</strong>
            <span>目标</span><strong>{{ detailItem.data.target_id || '-' }}</strong>
          </div>
          <div class="detail-block" v-if="detailItem.data.error">
            <label>错误</label>
            <p class="danger">{{ detailItem.data.error }}</p>
          </div>
        </template>

        <div v-else class="detail-empty">
          <strong>选择一条记录</strong>
          <span>查看样本、平台投影、任务进度和 provider 元数据。</span>
        </div>
      </aside>
    </div>

    <div v-if="clonePickerVisible" class="modal-backdrop" @click.self="closeClonePicker">
      <div class="clone-modal">
        <div class="modal-header">
          <div>
            <span class="detail-kicker">CLONE VOICE</span>
            <h3>{{ clonePickerProfiles.length > 1 ? `克隆 ${clonePickerProfiles.length} 个音色资产` : `克隆「${clonePickerProfiles[0]?.name || '音色资产'}」` }}</h3>
          </div>
          <button class="close-btn" :disabled="cloneSubmitting" @click="closeClonePicker">×</button>
        </div>

        <div class="provider-choice-list">
          <button
            v-for="provider in cloneProviderOptions"
            :key="provider.value"
            class="provider-choice"
            :class="{ active: clonePickerProvider === provider.value }"
            @click="clonePickerProvider = provider.value; cloneTargetProvider = provider.value"
          >
            <span>{{ provider.label }}</span>
            <span class="mono-text">{{ provider.value }}</span>
          </button>
        </div>

        <div class="clone-summary">
          <strong>{{ selectedCloneProviderLabel }}</strong>
          <span>{{ clonePickerCloneableProfiles.length }} 个将开始克隆</span>
          <span v-if="clonePickerAlreadyClonedProfiles.length > 0">
            {{ clonePickerAlreadyClonedProfiles.length }} 个已在该平台克隆，将跳过
          </span>
        </div>

        <div class="modal-actions">
          <button class="btn btn-outline" :disabled="cloneSubmitting" @click="closeClonePicker">取消</button>
          <button
            class="btn btn-primary"
            :disabled="cloneSubmitting || clonePickerCloneableProfiles.length === 0"
            @click="submitClonePicker"
          >
            {{ cloneSubmitting ? '提交中…' : '开始克隆' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="uploadVisible" class="modal-backdrop" @click.self="closeUpload">
      <div class="upload-modal">
        <div class="modal-header">
          <div>
            <span class="detail-kicker">CREATE VOICE PROFILE</span>
            <h3>上传样本音色</h3>
          </div>
          <button class="close-btn" @click="closeUpload">×</button>
        </div>
        <div class="form-grid">
          <label>
            音色名称
            <input v-model="uploadForm.name" class="form-input" placeholder="例如：林老师旁白" />
          </label>
          <label>
            语言
            <input v-model="uploadForm.language" class="form-input" placeholder="zh-CN" />
          </label>
          <label>
            授权状态
            <select v-model="uploadForm.consent_status" class="form-input">
              <option value="confirmed">我有权使用</option>
              <option value="unknown">未确认</option>
              <option value="restricted">仅测试</option>
            </select>
          </label>
          <label v-if="uploadForm.cloneToProvider">
            克隆平台
            <select v-model="uploadForm.provider" class="form-input">
              <option v-for="provider in cloneProviderOptions" :key="provider.value" :value="provider.value">
                {{ provider.label }}
              </option>
            </select>
          </label>
          <label>
            样本音频
            <input ref="fileInput" class="form-input file-input" type="file" accept="audio/*" @change="onFileChange" />
          </label>
          <label class="full">
            描述
            <input v-model="uploadForm.description" class="form-input" placeholder="用途、说话人特点或备注" />
          </label>
          <label class="full">
            样本文本
            <textarea v-model="uploadForm.sample_text" class="form-input text-area" placeholder="填写与样本音频对应的朗读文本" />
          </label>
        </div>
        <div class="modal-check">
          <input id="cloneToProvider" v-model="uploadForm.cloneToProvider" type="checkbox" />
          <label for="cloneToProvider">上传后立即克隆到平台</label>
          <span class="mono-text">可稍后从资产列表单条或批量克隆</span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="closeUpload">取消</button>
          <button class="btn btn-primary" :disabled="!uploadForm.file || uploadSaving" @click="submitUpload">
            {{ uploadSaving ? '提交中…' : '创建音色资产' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.voice-console {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: calc(100vh - 96px);
  min-height: 640px;
}

.console-header,
.toolbar,
.provider-strip,
.console-body,
.data-panel,
.detail-panel {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
}

.console-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
}

.console-header h2 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 4px;
}

.console-subtitle,
.panel-count,
.provider-meta {
  color: var(--text-muted);
  font-size: 10px;
}

.header-actions,
.filters,
.tabs,
.row-title,
.row-sub,
.projection-stack,
.clone-target-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clone-target-control {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.select-all-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.select-all-control input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent-cyan);
}

.select-all-control:has(input:disabled) {
  opacity: 0.45;
}

.btn,
.icon-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.18s;
}

.btn-primary {
  background: var(--accent-cyan);
  color: var(--bg-base);
}

.btn-outline,
.icon-btn {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: transparent;
}

.btn:hover:not(:disabled),
.icon-btn:hover:not(:disabled) {
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
}

.btn-primary:hover:not(:disabled) {
  color: var(--bg-base);
  background: var(--accent-cyan-hover);
}

.btn:disabled,
.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.provider-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(280px, 1fr));
  gap: 10px;
  padding: 10px;
  align-items: start;
}

.provider-group {
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: var(--bg-input);
  overflow: hidden;
  transition: border-color 0.18s, box-shadow 0.18s;
}

.provider-group.active {
  border-color: rgba(0, 212, 170, 0.45);
  box-shadow: inset 0 2px 0 rgba(0, 212, 170, 0.5);
}

.provider-group-header {
  width: 100%;
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 11px;
  color: var(--text-secondary);
  text-align: left;
}

.provider-group-header:hover {
  background: rgba(0, 212, 170, 0.035);
}

.provider-group-header > span:first-child {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 8px;
  align-items: baseline;
}

.provider-type {
  grid-column: 1 / -1;
  color: var(--text-muted);
  font-size: 8px;
  letter-spacing: 0.12em;
}

.provider-name {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.provider-id {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-status {
  flex-shrink: 0;
  color: var(--accent-cyan);
  font-size: 11px;
}

.provider-status.unavailable {
  color: #f87171;
}

.provider-status.account-warning {
  color: var(--warning-amber);
}

.provider-account {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  padding: 8px 11px;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.018);
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.5;
}

.provider-account span {
  display: inline-flex;
  gap: 4px;
  white-space: nowrap;
}

.provider-account b {
  color: var(--text-muted);
  font-weight: 600;
}

.provider-account.warning,
.provider-account.warning b {
  color: #f87171;
}

.provider-balance-note,
.provider-usage-time {
  flex-basis: 100%;
}

.provider-configs {
  display: grid;
  gap: 6px;
  padding: 9px;
}

.config-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 2px;
  color: var(--text-muted);
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.provider-config {
  position: relative;
  display: grid;
  grid-template-columns: 3px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 58px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.12);
}

.provider-config.active {
  border-color: rgba(0, 212, 170, 0.28);
  background: rgba(0, 212, 170, 0.045);
}

.config-state-indicator {
  width: 3px;
  height: 100%;
  min-height: 38px;
  border-radius: 2px;
  background: var(--border-color);
}

.provider-config.active .config-state-indicator {
  background: var(--accent-cyan);
  box-shadow: 0 0 8px rgba(0, 212, 170, 0.35);
}

.config-main {
  min-width: 0;
}

.config-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  color: var(--text-primary);
  font-size: 11px;
}

.config-name-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-badge {
  padding: 1px 4px;
  border: 1px solid var(--border-color);
  border-radius: 2px;
  color: var(--text-muted);
  font-size: 8px;
  font-weight: 700;
}

.config-badge.active {
  border-color: rgba(0, 212, 170, 0.35);
  color: var(--accent-cyan);
}

.config-badge.environment {
  border-color: rgba(96, 165, 250, 0.35);
  color: #93c5fd;
}

.config-details {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 8px;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 8px;
  line-height: 1.4;
}

.config-details span {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activate-config-btn {
  padding: 5px 7px;
  border: 1px solid rgba(0, 212, 170, 0.3);
  border-radius: var(--radius-sm);
  color: var(--accent-cyan);
  font-size: 9px;
  white-space: nowrap;
}

.activate-config-btn:hover:not(:disabled) {
  background: rgba(0, 212, 170, 0.08);
}

.activate-config-btn:disabled {
  opacity: 0.45;
  cursor: wait;
}

.runtime-route {
  color: var(--accent-cyan);
  font-size: 8px;
  white-space: nowrap;
}

.config-empty-state {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 10px;
}

.config-empty-state a {
  flex-shrink: 0;
  color: var(--accent-cyan);
}

.config-action-error {
  margin: 0 10px;
  padding: 7px 10px;
  border: 1px solid rgba(248, 113, 113, 0.32);
  border-radius: var(--radius-sm);
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.06);
  font-size: 11px;
}

.provider-empty {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  padding: 0 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  min-height: 48px;
  gap: 12px;
}

.tabs button {
  height: 48px;
  padding: 0 10px;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  font-size: 12px;
}

.tabs button.active {
  color: var(--accent-cyan);
  border-bottom-color: var(--accent-cyan);
}

.search-input,
.select-input,
.form-input {
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  padding: 0 10px;
  font-size: 12px;
  outline: none;
}

.search-input {
  width: 240px;
}

.select-input {
  width: 130px;
}

.search-input:focus,
.select-input:focus,
.form-input:focus {
  border-color: var(--accent-cyan);
}

.console-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--space-3);
  padding: var(--space-3);
  background: transparent;
  border: none;
}

.main-panel,
.data-panel,
.detail-panel {
  min-height: 0;
}

.data-panel {
  height: 100%;
  overflow: auto;
  padding: 14px;
}

.panel-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-title-row h3 {
  font-size: 14px;
  color: var(--text-secondary);
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-input.compact {
  width: 150px;
}

.asset-row,
.provider-voice-row,
.job-row {
  width: 100%;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto 82px;
  align-items: center;
  gap: 12px;
  padding: 10px;
  margin-bottom: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.asset-row {
  grid-template-columns: 18px 38px minmax(0, 1fr) auto 72px 82px 30px;
}

.provider-voice-row {
  grid-template-columns: 38px minmax(0, 1fr) 82px auto;
}

.row-check {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-cyan);
}

.job-row {
  grid-template-columns: 78px minmax(0, 1fr);
}

.asset-row:hover,
.provider-voice-row:hover,
.job-row:hover,
.asset-row.selected,
.provider-voice-row.selected,
.job-row.selected {
  border-color: rgba(0, 212, 170, 0.42);
  background: rgba(0, 212, 170, 0.04);
}

.voice-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bg-base);
  background: var(--accent-cyan);
  font-weight: 800;
  flex-shrink: 0;
}

.voice-avatar.provider {
  background: #60a5fa;
}

.row-main {
  min-width: 0;
}

.row-title {
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
}

.row-title > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
  flex-wrap: wrap;
}

.chip,
.projection-chip,
.job-status {
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.chip.warning {
  color: var(--warning-amber);
  border-color: rgba(245, 158, 11, 0.35);
}

.favorite-chip {
  color: #facc15;
  border-color: rgba(250, 204, 21, 0.35);
  background: rgba(250, 204, 21, 0.1);
}

.unavailable-chip {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.1);
}

.favorite-btn {
  width: 82px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  transition: all 0.18s;
}

.favorite-btn:hover,
.favorite-btn.active {
  color: #facc15;
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(250, 204, 21, 0.12);
}

.icon-delete-btn {
  width: 30px;
  min-width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(239, 68, 68, 0.32);
  border-radius: var(--radius-sm);
  background: transparent;
  color: #f87171;
  transition: all 0.18s;
  flex: 0 0 30px;
  white-space: nowrap;
  line-height: 1;
  padding: 0;
}

.icon-delete-btn:hover:not(:disabled) {
  border-color: rgba(239, 68, 68, 0.56);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.icon-delete-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.delete-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(248, 113, 113, 0.3);
  border-top-color: #f87171;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.projection-stack {
  justify-content: flex-end;
  flex-wrap: wrap;
  max-width: 220px;
}

.projection-chip.status-active,
.chip.status-active,
.job-status.status-active {
  color: var(--accent-cyan);
  border-color: rgba(0, 212, 170, 0.35);
}

.projection-chip.status-pending,
.chip.status-pending,
.job-status.status-pending {
  color: var(--warning-amber);
  border-color: rgba(245, 158, 11, 0.35);
}

.projection-chip.status-failed,
.chip.status-failed,
.job-status.status-failed,
.danger {
  color: #ef4444;
}

.projection-chip.muted {
  color: var(--text-muted);
}

.row-audio {
  width: 38px; /* 默认折叠状态，刚好露出播放按钮 */
  height: 38px;
  display: flex;
  justify-content: flex-end; /* 内部靠右对齐，确保折叠时展示最右侧的播放按钮 */
  overflow: hidden; /* 核心：超出容器剪裁遮蔽 */
  transition: width 0.38s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.row-audio.is-expanded {
  width: 220px; /* 展开状态，与锁定的 AudioTrack 宽度一致 */
}

/* 锁定列表内层 AudioTrack 的固定宽度 */
.row-audio :deep(.audio-track) {
  width: 220px;
  flex-shrink: 0;
}

.loading-more {
  padding: 12px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}

.detail-panel {
  overflow: auto;
  padding: 16px;
}

.detail-header {
  margin-bottom: 14px;
}

.detail-kicker {
  display: block;
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 10px;
  margin-bottom: 4px;
}

.detail-header h3 {
  font-size: 16px;
  line-height: 1.35;
}

.detail-grid {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 16px 0;
  font-size: 12px;
}

.detail-grid span {
  color: var(--text-muted);
}

.detail-grid strong {
  color: var(--text-secondary);
  min-width: 0;
  overflow-wrap: anywhere;
}

.detail-block {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
}

.detail-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.detail-block label {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  margin-bottom: 8px;
}

.detail-block p,
.detail-empty span,
.empty-block span {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.detail-empty,
.empty-block {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}

.progress-track {
  height: 7px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-input);
  border: 1px solid var(--border-color);
}

.progress-track span {
  display: block;
  height: 100%;
  background: var(--accent-cyan);
}

.capability-table {
  min-width: 920px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.capability-head,
.capability-row {
  display: grid;
  grid-template-columns: 120px 120px repeat(8, 1fr);
}

.capability-head span,
.capability-row span {
  padding: 9px 10px;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
}

.capability-head {
  background: var(--bg-input);
  color: var(--text-secondary);
  font-weight: 700;
}

.capability-row span {
  color: var(--text-muted);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  background: rgba(0, 0, 0, 0.68);
}

.upload-modal,
.clone-modal {
  width: min(720px, 100%);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 18px;
}

.clone-modal {
  width: min(520px, 100%);
}

.modal-header,
.modal-actions,
.modal-check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.close-btn {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  color: var(--text-muted);
}

.provider-choice-list {
  display: grid;
  gap: 10px;
  margin: 18px 0 12px;
}

.provider-choice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--bg-input);
  text-align: left;
}

.provider-choice.active,
.provider-choice:hover {
  border-color: rgba(0, 212, 170, 0.55);
  color: var(--text-primary);
  background: rgba(0, 212, 170, 0.06);
}

.clone-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 16px;
  color: var(--text-muted);
  font-size: 12px;
}

.clone-summary strong {
  color: var(--text-primary);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 160px 160px;
  gap: 12px;
  margin: 18px 0;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}

.form-grid label.full {
  grid-column: 1 / -1;
}

.text-area {
  height: 110px;
  resize: vertical;
  padding: 10px;
  line-height: 1.6;
}

.file-input {
  padding-top: 5px;
}

.modal-check {
  justify-content: flex-start;
  color: var(--text-secondary);
  font-size: 12px;
  margin-bottom: 16px;
}

@media (max-width: 1100px) {
  .voice-console {
    height: auto;
  }

  .console-body {
    grid-template-columns: 1fr;
  }

  .provider-strip {
    grid-template-columns: 1fr;
  }

  .detail-panel {
    min-height: 280px;
  }

  .toolbar {
    align-items: stretch;
    flex-direction: column;
    padding: 10px 12px;
  }

  .filters {
    flex-wrap: wrap;
  }

  .search-input {
    width: min(100%, 360px);
  }
}
</style>

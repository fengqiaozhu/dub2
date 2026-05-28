<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AudioTrack from '@/components/common/AudioTrack.vue';
import request, { toMediaUrl } from '@/api/request';
import { fetchTtsVoicePage, fetchVoiceProfilePage } from '@/api/voices';

type TabId = 'assets' | 'platform';
type BindingPayload = {
  voice_id?: string;
  provider?: string;
  provider_voice_id?: string | null;
  voice_source?: 'system' | 'clone';
  voice_profile_id?: number | null;
  display_name?: string;
  status?: string;
};
type VoiceFavorite = {
  favorite_key: string;
  provider?: string | null;
  provider_voice_id?: string | null;
  voice_source: 'system' | 'clone';
  voice_profile_id?: number | null;
};
type VoiceUsage = {
  provider?: string | null;
  provider_voice_id?: string | null;
  voice_id?: string | null;
  voice_source?: 'system' | 'clone' | null;
  voice_profile_id?: number | null;
  role_count: number;
  dialogue_count: number;
  chapter_count: number;
};
type ProviderStatus = {
  provider: string;
  synthesis_available: boolean;
  reason?: string | null;
};
type ProviderProjection = {
  provider: string;
  status?: string;
};
type PageState = {
  offset: number;
  hasMore: boolean;
  loading: boolean;
};

const props = defineProps<{
  visible: boolean;
  title: string;
  selectedVoiceId?: string | null;
  bookId?: string | number | null;
}>();

const emit = defineEmits<{
  select: [binding: BindingPayload];
  close: [];
}>();

const activeTab = ref<TabId>('assets');
const searchQuery = ref('');
const providerFilter = ref('all');
const assetVoices = ref<any[]>([]);
const platformVoices = ref<any[]>([]);
const providers = ref<any[]>([]);
const providerStatuses = ref<Record<string, ProviderStatus>>({});
const favorites = ref<VoiceFavorite[]>([]);
const voiceUsage = ref<VoiceUsage[]>([]);
const loadingAssets = ref(false);
const loadingPlatform = ref(false);
const loadingMeta = ref(false);
const loadingMoreAssets = ref(false);
const loadingMorePlatform = ref(false);
const pendingBinding = ref<BindingPayload | null>(null);
const playingId = ref<string | null>(null);
const assetPageState = ref<PageState>({ offset: 0, hasMore: true, loading: false });
const platformPageStates = ref<Record<string, PageState>>({});
const VOICE_PAGE_LIMIT = 60;

const profileKey = (profileId: string | number) => `profile:${profileId}`;
const providerVoiceKey = (provider: string, source: string, providerVoiceId: string) => `${provider || 'mosi'}:${source || 'clone'}:${providerVoiceId}`;

const favoriteKeyForAsset = (profile: any) => profileKey(profile.id);
const favoriteKeyForVoice = (voice: any) => providerVoiceKey(voice.provider, voice.kind, voice.provider_voice_id);
const usageKey = (usage: VoiceUsage) => {
  const voiceId = usage.provider_voice_id || usage.voice_id;
  if (voiceId) return providerVoiceKey(usage.provider || 'mosi', usage.voice_source || 'clone', voiceId);
  if (usage.voice_profile_id) return profileKey(usage.voice_profile_id);
  return '';
};

const favoriteKeys = computed(() => new Set(favorites.value.map((favorite) => favorite.favorite_key)));
const usageMap = computed(() => {
  const map = new Map<string, VoiceUsage>();
  voiceUsage.value.forEach((usage) => {
    const key = usageKey(usage);
    if (key) map.set(key, usage);
  });
  return map;
});

const sortByPriority = <T,>(items: T[], getKey: (item: T) => string) => {
  return [...items].sort((a, b) => {
    const aKey = getKey(a);
    const bKey = getKey(b);
    const aFavorite = favoriteKeys.value.has(aKey) ? 1 : 0;
    const bFavorite = favoriteKeys.value.has(bKey) ? 1 : 0;
    if (aFavorite !== bFavorite) return bFavorite - aFavorite;

    const aUsage = usageMap.value.get(aKey);
    const bUsage = usageMap.value.get(bKey);
    const aDialogues = Number(aUsage?.dialogue_count || 0);
    const bDialogues = Number(bUsage?.dialogue_count || 0);
    if (aDialogues !== bDialogues) return bDialogues - aDialogues;

    const aRoles = Number(aUsage?.role_count || 0);
    const bRoles = Number(bUsage?.role_count || 0);
    if (aRoles !== bRoles) return bRoles - aRoles;

    return 0;
  });
};

const filteredAssets = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const matched = assetVoices.value.filter((voice) => {
    if (!q) return true;
    return [voice.name, voice.sample_text, voice.language, voice.provider_statuses]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
  return sortByPriority(matched, favoriteKeyForAsset);
});

const filteredPlatform = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const matched = platformVoices.value.filter((voice) => {
    const providerMatch = providerFilter.value === 'all' || voice.provider === providerFilter.value;
    const textMatch = !q || [voice.name, voice.provider_voice_id, voice.provider, voice.kind, voice.language]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
    return providerMatch && textMatch;
  });
  return sortByPriority(matched, favoriteKeyForVoice);
});

const selectedLabel = computed(() => {
  if (!pendingBinding.value) return '';
  return pendingBinding.value.display_name || pendingBinding.value.provider_voice_id || pendingBinding.value.voice_id || '';
});

const avatarColor = (name: string) => {
  const colors = ['#00d4aa', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
};

const providerStatusChips = (profile: any) => {
  if (!profile.provider_statuses) return [];
  return String(profile.provider_statuses).split(',').filter(Boolean).map((item): ProviderProjection => {
    const [provider, status] = item.split(':');
    return { provider, status };
  });
};

const statusLabel = (status?: string) => {
  const upper = String(status || '').toUpperCase();
  if (upper === 'ACTIVE' || upper === 'DONE') return '可用';
  if (upper === 'PENDING' || upper === 'RUNNING') return '处理中';
  if (upper === 'FAILED') return '失败';
  return status || '未知';
};

const isUsableStatus = (status?: string) => ['ACTIVE', 'DONE'].includes(String(status || '').toUpperCase());
const isFavoriteKey = (key: string) => favoriteKeys.value.has(key);
const usageForKey = (key: string) => usageMap.value.get(key);
const providerStatusFor = (provider: string) => providerStatuses.value[provider];
const isProviderSynthAvailable = (provider: string) => providerStatusFor(provider)?.synthesis_available !== false;
const providerUnavailableReason = (provider: string) => providerStatusFor(provider)?.reason || '该平台当前不可配音';
const providerDisplayName = (provider: string) => (
  providers.value.find((item: any) => item.provider === provider)?.displayName || provider
);
const isConfirmedProviderVoice = (voice: any) => voice.kind === 'system' || voice.projection_confirmed !== false;
const providerVoiceUnavailableReason = (voice: any) => {
  if (!isProviderSynthAvailable(voice.provider)) return providerUnavailableReason(voice.provider);
  if (!isConfirmedProviderVoice(voice)) return '未匹配到本地音色资产';
  return '';
};
const canSelectProviderVoice = (voice: any) => isProviderSynthAvailable(voice.provider) && isConfirmedProviderVoice(voice);
const canSelectAssetProjection = (projection: ProviderProjection) => (
  isUsableStatus(projection.status) && isProviderSynthAvailable(projection.provider)
);
const selectableAssetProjections = (profile: any) => providerStatusChips(profile).filter(canSelectAssetProjection);
const assetProjectionReason = (projection: ProviderProjection) => {
  if (!isProviderSynthAvailable(projection.provider)) return providerUnavailableReason(projection.provider);
  if (!isUsableStatus(projection.status)) return statusLabel(projection.status);
  return `绑定到 ${providerDisplayName(projection.provider)}`;
};
const isSelectedAssetProjection = (profile: any, projection: ProviderProjection) => (
  pendingBinding.value?.voice_profile_id === profile.id
  && pendingBinding.value?.provider === projection.provider
  && !pendingBinding.value?.provider_voice_id
);
const pendingBindingAvailable = computed(() => (
  !pendingBinding.value || isProviderSynthAvailable(pendingBinding.value.provider || 'mosi')
));

const profileAudioSrc = (profile: any) => profile.sample_audio_url ? toMediaUrl(profile.sample_audio_url) : '';
const voiceAudioSrc = (voice: any) => {
  const src = voice.previewAudioUrl || voice.sample_audio_url || voice.raw?.previewAudioUrl || '';
  return src.startsWith('/') ? toMediaUrl(src) : src;
};

const fetchProviders = async () => {
  try {
    const [res, statusRes]: any[] = await Promise.all([
      request.get('/tts/providers'),
      request.get('/tts/providers/status').catch(() => ({ data: [] })),
    ]);
    providers.value = res.data || [];
    providerStatuses.value = Object.fromEntries((statusRes.data || []).map((status: ProviderStatus) => [status.provider, status]));
  } catch (error) {
    providers.value = [];
    providerStatuses.value = {};
  }
};

const fetchAssets = async () => {
  loadingAssets.value = true;
  assetVoices.value = [];
  assetPageState.value = { offset: 0, hasMore: true, loading: false };
  try {
    await loadMoreAssets();
  } catch (error) {
    console.error('Failed to fetch voice profiles:', error);
    assetVoices.value = [];
  } finally {
    loadingAssets.value = false;
  }
};

const mapVoice = (voice: any, kind: 'system' | 'clone') => ({
  ...voice,
  provider: voice.provider || 'mosi',
  provider_voice_id: voice.provider_voice_id || voice.voice_id || voice.voiceId || voice.id,
  name: voice.name || voice.voiceName || '未命名',
  kind,
  status: voice.status || (kind === 'system' ? 'ACTIVE' : 'UNKNOWN'),
});

const providerKindKey = (provider: string, kind: 'system' | 'clone') => `${provider}:${kind}`;

const currentProviderIds = () => (
  providers.value.length > 0
    ? providers.value.map((provider) => provider.provider).filter(Boolean)
    : ['mosi']
);

const loadMoreAssets = async () => {
  const state = assetPageState.value;
  if (state.loading || !state.hasMore) return;
  state.loading = true;
  loadingMoreAssets.value = true;
  try {
    const page = await fetchVoiceProfilePage({ limit: VOICE_PAGE_LIMIT, offset: state.offset });
    assetVoices.value.push(...page.profiles);
    state.offset = page.nextOffset;
    state.hasMore = page.hasMore;
  } finally {
    state.loading = false;
    loadingMoreAssets.value = false;
  }
};

const fetchPlatform = async () => {
  loadingPlatform.value = true;
  platformVoices.value = [];
  platformPageStates.value = {};
  currentProviderIds().forEach((provider) => {
    (['system', 'clone'] as const).forEach((kind) => {
      platformPageStates.value[providerKindKey(provider, kind)] = {
        offset: 0,
        hasMore: true,
        loading: false,
      };
    });
  });
  try {
    await loadMorePlatform();
  } catch (error) {
    console.error('Failed to fetch platform voices:', error);
    platformVoices.value = [];
  } finally {
    loadingPlatform.value = false;
  }
};

const loadMorePlatform = async () => {
  if (loadingMorePlatform.value) return;
  const targets = currentProviderIds().flatMap((provider) => (
    (['system', 'clone'] as const).map((kind) => ({ provider, kind }))
  )).filter(({ provider, kind }) => {
    const state = platformPageStates.value[providerKindKey(provider, kind)];
    return state?.hasMore && !state.loading;
  });

  if (targets.length === 0) return;
  loadingMorePlatform.value = true;
  try {
    const pages = await Promise.all(targets.map(async ({ provider, kind }) => {
      const key = providerKindKey(provider, kind);
      const state = platformPageStates.value[key];
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
        return page.voices.map((voice: any) => mapVoice({ ...voice, provider }, kind));
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
    loadingMorePlatform.value = false;
  }
};

const handleAssetScroll = (event: Event) => {
  const el = event.currentTarget as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    loadMoreAssets();
  }
};

const handlePlatformScroll = (event: Event) => {
  const el = event.currentTarget as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    loadMorePlatform();
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

const fetchVoiceUsage = async () => {
  if (!props.bookId) {
    voiceUsage.value = [];
    return;
  }

  try {
    const res: any = await request.get(`/books/${props.bookId}/voice-usage`);
    voiceUsage.value = res.data || [];
  } catch (error) {
    console.error('Failed to fetch voice usage:', error);
    voiceUsage.value = [];
  }
};

const toggleAssetFavorite = async (profile: any) => {
  const key = favoriteKeyForAsset(profile);
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

const togglePlatformFavorite = async (voice: any) => {
  const key = favoriteKeyForVoice(voice);
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
      name_snapshot: voice.name,
    });
    favorites.value = [res.data, ...favorites.value.filter((favorite) => favorite.favorite_key !== key)];
  } catch (error) {
    console.error('Failed to toggle voice favorite:', error);
  }
};

const selectAssetProjection = (profile: any, projection: ProviderProjection) => {
  if (!canSelectAssetProjection(projection)) return;
  pendingBinding.value = {
    voice_id: '',
    provider: projection.provider,
    provider_voice_id: null,
    voice_source: 'clone',
    voice_profile_id: profile.id,
    display_name: profile.name,
    status: `${providerDisplayName(projection.provider)} ${statusLabel(projection.status)}`,
  };
};

const selectAsset = (profile: any) => {
  const projections = selectableAssetProjections(profile);
  if (projections.length === 1) {
    selectAssetProjection(profile, projections[0]);
  }
};

const selectPlatformVoice = (voice: any) => {
  if (!canSelectProviderVoice(voice)) return;
  pendingBinding.value = {
    voice_id: voice.provider_voice_id,
    provider: voice.provider,
    provider_voice_id: voice.provider_voice_id,
    voice_source: voice.kind === 'system' ? 'system' : 'clone',
    voice_profile_id: voice.voice_profile_id || null,
    display_name: voice.name,
    status: voice.status,
  };
};

const confirmSelect = () => {
  if (!pendingBinding.value || !pendingBindingAvailable.value) return;
  emit('select', pendingBinding.value);
  emit('close');
};

const handleClose = () => {
  playingId.value = null;
  emit('close');
};

const togglePlay = (id: string) => {
  playingId.value = playingId.value === id ? null : id;
};

watch(() => props.visible, async (visible) => {
  if (!visible) {
    playingId.value = null;
    return;
  }
  pendingBinding.value = null;
  searchQuery.value = '';
  loadingMeta.value = true;
  try {
    await fetchProviders();
    await Promise.all([fetchFavorites(), fetchVoiceUsage(), fetchAssets(), fetchPlatform()]);
  } finally {
    loadingMeta.value = false;
  }
});

watch(activeTab, () => {
  playingId.value = null;
  searchQuery.value = '';
});

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.visible) handleClose();
};

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="modal-overlay" @click.self="handleClose">
        <div class="modal-panel" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div class="header-left">
              <span class="hdr-icon">◎</span>
              <div>
                <h2 class="modal-title">选择音色</h2>
                <p class="modal-sub mono-text">为「{{ title }}」绑定音色资产或平台音色</p>
              </div>
            </div>
            <button class="close-btn" @click="handleClose">×</button>
          </div>

          <div class="tab-bar">
            <button class="tab-btn" :class="{ active: activeTab === 'assets' }" @click="activeTab = 'assets'">
              音色资产 <span class="tab-cnt mono-text">{{ assetVoices.length }}</span>
            </button>
            <button class="tab-btn" :class="{ active: activeTab === 'platform' }" @click="activeTab = 'platform'">
              平台音色 <span class="tab-cnt mono-text">{{ platformVoices.length }}</span>
            </button>
            <select v-model="providerFilter" class="provider-select">
              <option value="all">全部 Provider</option>
              <option v-for="p in providers" :key="p.provider" :value="p.provider">{{ p.displayName || p.provider }}</option>
            </select>
            <div class="search-box">
              <input v-model="searchQuery" class="search-input mono-text" placeholder="搜索音色…" />
            </div>
          </div>

          <div class="list-area">
            <div v-show="activeTab === 'assets'" class="voice-list" @scroll="handleAssetScroll">
              <div v-if="loadingAssets" class="list-loading mono-text">加载中…</div>
              <div v-else-if="filteredAssets.length === 0" class="list-empty mono-text">暂无音色资产，请先在音色管理上传样本</div>
              <div
                v-for="profile in filteredAssets"
                v-else
                :key="profile.id"
                class="voice-item"
                :class="{ selected: pendingBinding?.voice_profile_id === profile.id && !pendingBinding?.provider_voice_id }"
                @click="selectAsset(profile)"
              >
                <div class="radio-outer"><div v-if="pendingBinding?.voice_profile_id === profile.id && !pendingBinding?.provider_voice_id" class="radio-inner" /></div>
                <div class="v-avatar" :style="{ backgroundColor: avatarColor(profile.name || 'V') }">{{ (profile.name || 'V').charAt(0) }}</div>
                <div class="v-info">
                  <span class="v-name">{{ profile.name }}</span>
                  <div class="v-tags">
                    <span v-if="isFavoriteKey(favoriteKeyForAsset(profile))" class="v-tag tag-favorite">收藏</span>
                    <span v-if="usageForKey(favoriteKeyForAsset(profile))" class="v-tag tag-usage mono-text">
                      {{ usageForKey(favoriteKeyForAsset(profile))?.dialogue_count }} 对白
                    </span>
                    <span class="v-tag tag-lang mono-text">{{ profile.language || 'LANG?' }}</span>
                    <span v-if="providerStatusChips(profile).length === 0" class="v-tag tag-pending">需克隆</span>
                    <button
                      v-for="chip in providerStatusChips(profile)"
                      :key="chip.provider"
                      type="button"
                      class="v-tag asset-provider-chip"
                      :class="{
                        'tag-active': canSelectAssetProjection(chip),
                        'tag-pending': !canSelectAssetProjection(chip),
                        selected: isSelectedAssetProjection(profile, chip)
                      }"
                      :disabled="!canSelectAssetProjection(chip)"
                      :title="assetProjectionReason(chip)"
                      @click.stop="selectAssetProjection(profile, chip)"
                    >
                      {{ providerDisplayName(chip.provider) }} {{ statusLabel(chip.status) }}
                    </button>
                  </div>
                </div>
                <button
                  class="favorite-btn"
                  :class="{ active: isFavoriteKey(favoriteKeyForAsset(profile)) }"
                  :title="isFavoriteKey(favoriteKeyForAsset(profile)) ? '取消收藏' : '收藏音色'"
                  @click.stop="toggleAssetFavorite(profile)"
                >
                  <span>{{ isFavoriteKey(favoriteKeyForAsset(profile)) ? '★' : '☆' }}</span>
                  <span>{{ isFavoriteKey(favoriteKeyForAsset(profile)) ? '已收藏' : '收藏' }}</span>
                </button>
                <div class="v-player" @click.stop>
                  <AudioTrack
                    :src="profileAudioSrc(profile)"
                    :active="playingId === `profile-${profile.id}`"
                    :filename="profile.name + '.wav'"
                    :show-download="false"
                    @activate="togglePlay(`profile-${profile.id}`)"
                    @deactivate="togglePlay(`profile-${profile.id}`)"
                  />
                </div>
              </div>
              <div v-if="!loadingAssets && loadingMoreAssets" class="list-more mono-text">加载更多…</div>
            </div>

            <div v-show="activeTab === 'platform'" class="voice-list" @scroll="handlePlatformScroll">
              <div v-if="loadingPlatform" class="list-loading mono-text">加载中…</div>
              <div v-else-if="filteredPlatform.length === 0" class="list-empty mono-text">暂无平台音色</div>
              <div
                v-for="voice in filteredPlatform"
                v-else
                :key="`${voice.provider}:${voice.provider_voice_id}`"
                class="voice-item"
                :class="{
                  selected: pendingBinding?.provider === voice.provider && pendingBinding?.provider_voice_id === voice.provider_voice_id,
                  disabled: !canSelectProviderVoice(voice)
                }"
                @click="selectPlatformVoice(voice)"
              >
                <div class="radio-outer"><div v-if="pendingBinding?.provider === voice.provider && pendingBinding?.provider_voice_id === voice.provider_voice_id" class="radio-inner" /></div>
                <div class="v-avatar" :style="{ backgroundColor: avatarColor(voice.name || 'V') }">{{ (voice.name || 'V').charAt(0) }}</div>
                <div class="v-info">
                  <span class="v-name">{{ voice.name }}</span>
                  <div class="v-tags">
                    <span v-if="isFavoriteKey(favoriteKeyForVoice(voice))" class="v-tag tag-favorite">收藏</span>
                    <span v-if="usageForKey(favoriteKeyForVoice(voice))" class="v-tag tag-usage mono-text">
                      {{ usageForKey(favoriteKeyForVoice(voice))?.dialogue_count }} 对白
                    </span>
                    <span class="v-tag tag-lang mono-text">{{ voice.provider }}</span>
                    <span v-if="!canSelectProviderVoice(voice)" class="v-tag tag-disabled">不可绑定</span>
                    <span class="v-tag" :class="voice.kind === 'system' ? 'tag-gender' : 'tag-clone'">{{ voice.kind === 'system' ? '系统预置' : '克隆' }}</span>
                    <span class="v-tag" :class="isUsableStatus(voice.status) ? 'tag-active' : 'tag-pending'">{{ statusLabel(voice.status) }}</span>
                    <span v-if="!canSelectProviderVoice(voice)" class="v-tag tag-disabled-reason">{{ providerVoiceUnavailableReason(voice) }}</span>
                  </div>
                </div>
                <button
                  class="favorite-btn"
                  :class="{ active: isFavoriteKey(favoriteKeyForVoice(voice)) }"
                  :title="isFavoriteKey(favoriteKeyForVoice(voice)) ? '取消收藏' : '收藏音色'"
                  @click.stop="togglePlatformFavorite(voice)"
                >
                  <span>{{ isFavoriteKey(favoriteKeyForVoice(voice)) ? '★' : '☆' }}</span>
                  <span>{{ isFavoriteKey(favoriteKeyForVoice(voice)) ? '已收藏' : '收藏' }}</span>
                </button>
                <div class="v-player" @click.stop>
                  <AudioTrack
                    :src="voiceAudioSrc(voice)"
                    :active="playingId === `${voice.provider}:${voice.provider_voice_id}`"
                    :filename="voice.name + '.wav'"
                    :show-download="false"
                    @activate="togglePlay(`${voice.provider}:${voice.provider_voice_id}`)"
                    @deactivate="togglePlay(`${voice.provider}:${voice.provider_voice_id}`)"
                  />
                </div>
              </div>
              <div v-if="!loadingPlatform && loadingMorePlatform" class="list-more mono-text">加载更多…</div>
            </div>
          </div>

          <div class="modal-footer">
            <div class="sel-preview">
              <template v-if="pendingBinding">
                <span class="sel-dot">◉</span>
                <span class="sel-name">{{ selectedLabel }}</span>
                <span v-if="pendingBinding.status" class="sel-status mono-text">{{ pendingBinding.status }}</span>
                <span v-if="!pendingBindingAvailable" class="sel-status unavailable mono-text">
                  {{ providerUnavailableReason(pendingBinding.provider || 'mosi') }}
                </span>
              </template>
              <span v-else class="sel-hint mono-text">选择音色资产或平台音色</span>
            </div>
            <div class="footer-btns">
              <button class="btn-cancel" @click="handleClose">取消</button>
              <button class="btn-confirm" :disabled="!pendingBinding || !pendingBindingAvailable" @click="confirmSelect">确认绑定</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
.modal-panel { background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: var(--radius-lg, 10px); width: 720px; max-width: 100%; max-height: 82vh; display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04); overflow: hidden; }
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity .18s ease, transform .18s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; transform: scale(.96) translateY(-6px); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; background: linear-gradient(135deg, rgba(0,212,170,.05) 0%, transparent 60%); }
.header-left { display: flex; align-items: center; gap: 12px; }
.hdr-icon { font-size: 20px; color: var(--accent-cyan); }
.modal-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0; }
.modal-sub { font-size: 11px; color: var(--text-muted); margin: 2px 0 0; }
.close-btn { width: 28px; height: 28px; background: transparent; border: 1px solid var(--border-color); border-radius: 50%; color: var(--text-muted); cursor: pointer; transition: all .18s; }
.close-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); background: rgba(255,255,255,.05); }
.tab-bar { display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-input); flex-shrink: 0; height: 44px; gap: 0; }
.tab-btn { display: flex; align-items: center; gap: 6px; padding: 0 12px; height: 100%; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font-size: 12px; font-weight: 500; cursor: pointer; transition: all .18s; white-space: nowrap; margin-bottom: -1px; }
.tab-btn:hover { color: var(--text-secondary); }
.tab-btn.active { color: var(--accent-cyan); border-bottom-color: var(--accent-cyan); }
.tab-cnt { font-size: 9px; padding: 1px 5px; border-radius: 10px; background: rgba(255,255,255,.07); color: var(--text-muted); }
.tab-btn.active .tab-cnt { background: rgba(0,212,170,.12); color: var(--accent-cyan); }
.provider-select { margin-left: auto; width: 120px; height: 28px; border: 1px solid var(--border-color); background: var(--bg-panel); color: var(--text-secondary); border-radius: var(--radius-sm); font-size: 11px; }
.search-box { display: flex; align-items: center; gap: 6px; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: var(--radius-sm, 4px); padding: 4px 8px; margin-left: 8px; transition: border-color .18s; }
.search-box:focus-within { border-color: var(--accent-cyan); }
.search-input { background: transparent; border: none; outline: none; font-size: 11px; color: var(--text-primary); width: 130px; }
.search-input::placeholder { color: var(--text-muted); }
.list-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.voice-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.voice-list::-webkit-scrollbar { width: 4px; }
.voice-list::-webkit-scrollbar-thumb { background: var(--border-focus); border-radius: 2px; }
.list-loading, .list-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-muted); padding: 40px; text-align: center; }
.list-more { padding: 10px 0; text-align: center; color: var(--text-muted); font-size: 11px; }
.voice-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-md, 6px); border: 1px solid transparent; background: var(--bg-input); cursor: pointer; transition: all .15s; }
.voice-item:hover { background: rgba(255,255,255,.04); border-color: var(--border-focus); }
.voice-item.selected { background: rgba(0,212,170,.07); border-color: rgba(0,212,170,.35); box-shadow: 0 0 0 1px rgba(0,212,170,.1); }
.voice-item.disabled { opacity: .68; cursor: not-allowed; }
.voice-item.disabled:hover { border-color: rgba(239,68,68,.28); background: rgba(239,68,68,.04); }
.radio-outer { width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--border-focus); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color .15s; }
.voice-item.selected .radio-outer { border-color: var(--accent-cyan); }
.radio-inner { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-cyan); }
.favorite-btn { width: 74px; height: 28px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 11px; font-weight: 600; line-height: 1; display: flex; align-items: center; justify-content: center; gap: 4px; flex-shrink: 0; transition: all .15s; }
.favorite-btn:hover { color: #facc15; border-color: rgba(250,204,21,.35); background: rgba(250,204,21,.08); }
.favorite-btn.active { color: #facc15; border-color: rgba(250,204,21,.45); background: rgba(250,204,21,.12); }
.v-avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; font-weight: 700; flex-shrink: 0; }
.v-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.v-name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.v-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.v-tag { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; letter-spacing: 0; }
.asset-provider-chip { cursor: pointer; }
.asset-provider-chip:disabled { cursor: not-allowed; opacity: .72; }
.asset-provider-chip.selected { box-shadow: 0 0 0 1px var(--accent-cyan); }
.tag-favorite { background: rgba(250,204,21,.12); color: #facc15; border: 1px solid rgba(250,204,21,.25); }
.tag-usage { background: rgba(0,212,170,.12); color: var(--accent-cyan); border: 1px solid rgba(0,212,170,.24); }
.tag-gender { background: rgba(139,92,246,.12); color: #a78bfa; border: 1px solid rgba(139,92,246,.25); }
.tag-lang { background: rgba(59,130,246,.12); color: #60a5fa; border: 1px solid rgba(59,130,246,.2); }
.tag-clone { background: rgba(245,158,11,.12); color: #f59e0b; border: 1px solid rgba(245,158,11,.25); }
.tag-active { background: rgba(34,197,94,.12); color: #4ade80; border: 1px solid rgba(34,197,94,.25); }
.tag-pending { background: rgba(107,114,128,.12); color: var(--text-muted); border: 1px solid var(--border-color); }
.tag-disabled { background: rgba(239,68,68,.12); color: #f87171; border: 1px solid rgba(239,68,68,.3); }
.tag-disabled-reason { background: rgba(107,114,128,.12); color: var(--text-muted); border: 1px solid var(--border-color); }
.v-player { width: 180px; flex-shrink: 0; }
.modal-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border-color); flex-shrink: 0; background: var(--bg-input); gap: 12px; }
.sel-preview { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.sel-dot { font-size: 10px; color: var(--accent-cyan); flex-shrink: 0; }
.sel-name { font-size: 12px; font-weight: 500; color: var(--accent-cyan); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sel-status { font-size: 10px; color: var(--text-muted); }
.sel-status.unavailable { color: #f87171; }
.sel-hint { font-size: 11px; color: var(--text-muted); }
.footer-btns { display: flex; gap: 8px; flex-shrink: 0; }
.btn-cancel { padding: 6px 14px; border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; transition: all .18s; }
.btn-cancel:hover { border-color: var(--text-secondary); color: var(--text-primary); }
.btn-confirm { padding: 6px 18px; border: none; background: var(--accent-cyan); color: #000; border-radius: var(--radius-sm); font-size: 12px; font-weight: 700; cursor: pointer; transition: all .18s; }
.btn-confirm:hover:not(:disabled) { background: #00f0c0; box-shadow: 0 0 12px rgba(0,212,170,.4); }
.btn-confirm:disabled { opacity: .35; cursor: not-allowed; }
</style>

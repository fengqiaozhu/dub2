<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AudioTrack from '@/components/common/AudioTrack.vue';
import request, { toMediaUrl } from '@/api/request';

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

const props = defineProps<{
  visible: boolean;
  title: string;
  selectedVoiceId?: string | null;
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
const loadingAssets = ref(false);
const loadingPlatform = ref(false);
const pendingBinding = ref<BindingPayload | null>(null);
const playingId = ref<string | null>(null);

const filteredAssets = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return assetVoices.value.filter((voice) => {
    if (!q) return true;
    return [voice.name, voice.sample_text, voice.language, voice.provider_statuses]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
});

const filteredPlatform = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return platformVoices.value.filter((voice) => {
    const providerMatch = providerFilter.value === 'all' || voice.provider === providerFilter.value;
    const textMatch = !q || [voice.name, voice.provider_voice_id, voice.provider, voice.kind, voice.language]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
    return providerMatch && textMatch;
  });
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
  return String(profile.provider_statuses).split(',').filter(Boolean).map((item) => {
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

const profileAudioSrc = (profile: any) => profile.sample_audio_url ? toMediaUrl(profile.sample_audio_url) : '';
const voiceAudioSrc = (voice: any) => {
  const src = voice.previewAudioUrl || voice.sample_audio_url || voice.raw?.previewAudioUrl || '';
  return src.startsWith('/audio') || src.startsWith('/voice-samples') ? toMediaUrl(src) : src;
};

const fetchProviders = async () => {
  try {
    const res: any = await request.get('/tts/providers');
    providers.value = res.data || [];
  } catch (error) {
    providers.value = [];
  }
};

const fetchAssets = async () => {
  loadingAssets.value = true;
  try {
    const res: any = await request.get('/tts/voice-profiles', { params: { limit: 100 } });
    assetVoices.value = res.data || [];
  } catch (error) {
    console.error('Failed to fetch voice profiles:', error);
    assetVoices.value = [];
  } finally {
    loadingAssets.value = false;
  }
};

const fetchPlatform = async () => {
  loadingPlatform.value = true;
  try {
    const [systemRes, cloneRes] = await Promise.all([
      request.get('/tts/voices', { params: { provider: 'mosi', kind: 'system', limit: 80 } }),
      request.get('/tts/voices', { params: { provider: 'mosi', kind: 'clone', limit: 80 } }),
    ]);
    const mapVoice = (voice: any, kind: 'system' | 'clone') => ({
      ...voice,
      provider: voice.provider || 'mosi',
      provider_voice_id: voice.provider_voice_id || voice.voice_id || voice.voiceId || voice.id,
      name: voice.name || voice.voiceName || '未命名',
      kind,
      status: voice.status || (kind === 'system' ? 'ACTIVE' : 'UNKNOWN'),
    });
    platformVoices.value = [
      ...(((systemRes as any).data?.voices || []).map((voice: any) => mapVoice(voice, 'system'))),
      ...(((cloneRes as any).data?.voices || []).map((voice: any) => mapVoice(voice, 'clone'))),
    ];
  } catch (error) {
    console.error('Failed to fetch platform voices:', error);
    platformVoices.value = [];
  } finally {
    loadingPlatform.value = false;
  }
};

const selectAsset = (profile: any) => {
  const projection = providerStatusChips(profile)[0];
  pendingBinding.value = {
    voice_id: '',
    provider: projection?.provider || 'mosi',
    provider_voice_id: null,
    voice_source: 'clone',
    voice_profile_id: profile.id,
    display_name: profile.name,
    status: projection ? statusLabel(projection.status) : '需克隆',
  };
};

const selectPlatformVoice = (voice: any) => {
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
  if (!pendingBinding.value) return;
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
  await Promise.all([fetchProviders(), fetchAssets(), fetchPlatform()]);
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
            <div v-show="activeTab === 'assets'" class="voice-list">
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
                    <span class="v-tag tag-lang mono-text">{{ profile.language || 'LANG?' }}</span>
                    <span v-if="providerStatusChips(profile).length === 0" class="v-tag tag-pending">需克隆</span>
                    <span v-for="chip in providerStatusChips(profile)" :key="chip.provider" class="v-tag tag-active">{{ chip.provider }} {{ statusLabel(chip.status) }}</span>
                  </div>
                </div>
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
            </div>

            <div v-show="activeTab === 'platform'" class="voice-list">
              <div v-if="loadingPlatform" class="list-loading mono-text">加载中…</div>
              <div v-else-if="filteredPlatform.length === 0" class="list-empty mono-text">暂无平台音色</div>
              <div
                v-for="voice in filteredPlatform"
                v-else
                :key="`${voice.provider}:${voice.provider_voice_id}`"
                class="voice-item"
                :class="{ selected: pendingBinding?.provider === voice.provider && pendingBinding?.provider_voice_id === voice.provider_voice_id }"
                @click="selectPlatformVoice(voice)"
              >
                <div class="radio-outer"><div v-if="pendingBinding?.provider === voice.provider && pendingBinding?.provider_voice_id === voice.provider_voice_id" class="radio-inner" /></div>
                <div class="v-avatar" :style="{ backgroundColor: avatarColor(voice.name || 'V') }">{{ (voice.name || 'V').charAt(0) }}</div>
                <div class="v-info">
                  <span class="v-name">{{ voice.name }}</span>
                  <div class="v-tags">
                    <span class="v-tag tag-lang mono-text">{{ voice.provider }}</span>
                    <span class="v-tag" :class="voice.kind === 'system' ? 'tag-gender' : 'tag-clone'">{{ voice.kind === 'system' ? '系统预置' : '克隆' }}</span>
                    <span class="v-tag" :class="String(voice.status).toUpperCase() === 'ACTIVE' ? 'tag-active' : 'tag-pending'">{{ statusLabel(voice.status) }}</span>
                  </div>
                </div>
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
            </div>
          </div>

          <div class="modal-footer">
            <div class="sel-preview">
              <template v-if="pendingBinding">
                <span class="sel-dot">◉</span>
                <span class="sel-name">{{ selectedLabel }}</span>
                <span v-if="pendingBinding.status" class="sel-status mono-text">{{ pendingBinding.status }}</span>
              </template>
              <span v-else class="sel-hint mono-text">选择音色资产或平台音色</span>
            </div>
            <div class="footer-btns">
              <button class="btn-cancel" @click="handleClose">取消</button>
              <button class="btn-confirm" :disabled="!pendingBinding" @click="confirmSelect">确认绑定</button>
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
.voice-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-md, 6px); border: 1px solid transparent; background: var(--bg-input); cursor: pointer; transition: all .15s; }
.voice-item:hover { background: rgba(255,255,255,.04); border-color: var(--border-focus); }
.voice-item.selected { background: rgba(0,212,170,.07); border-color: rgba(0,212,170,.35); box-shadow: 0 0 0 1px rgba(0,212,170,.1); }
.radio-outer { width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--border-focus); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color .15s; }
.voice-item.selected .radio-outer { border-color: var(--accent-cyan); }
.radio-inner { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-cyan); }
.v-avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; font-weight: 700; flex-shrink: 0; }
.v-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.v-name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.v-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.v-tag { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; letter-spacing: .04em; }
.tag-gender { background: rgba(139,92,246,.12); color: #a78bfa; border: 1px solid rgba(139,92,246,.25); }
.tag-lang { background: rgba(59,130,246,.12); color: #60a5fa; border: 1px solid rgba(59,130,246,.2); }
.tag-clone { background: rgba(245,158,11,.12); color: #f59e0b; border: 1px solid rgba(245,158,11,.25); }
.tag-active { background: rgba(34,197,94,.12); color: #4ade80; border: 1px solid rgba(34,197,94,.25); }
.tag-pending { background: rgba(107,114,128,.12); color: var(--text-muted); border: 1px solid var(--border-color); }
.v-player { width: 180px; flex-shrink: 0; }
.modal-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border-color); flex-shrink: 0; background: var(--bg-input); gap: 12px; }
.sel-preview { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.sel-dot { font-size: 10px; color: var(--accent-cyan); flex-shrink: 0; }
.sel-name { font-size: 12px; font-weight: 500; color: var(--accent-cyan); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sel-status { font-size: 10px; color: var(--text-muted); }
.sel-hint { font-size: 11px; color: var(--text-muted); }
.footer-btns { display: flex; gap: 8px; flex-shrink: 0; }
.btn-cancel { padding: 6px 14px; border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; transition: all .18s; }
.btn-cancel:hover { border-color: var(--text-secondary); color: var(--text-primary); }
.btn-confirm { padding: 6px 18px; border: none; background: var(--accent-cyan); color: #000; border-radius: var(--radius-sm); font-size: 12px; font-weight: 700; cursor: pointer; transition: all .18s; }
.btn-confirm:hover:not(:disabled) { background: #00f0c0; box-shadow: 0 0 12px rgba(0,212,170,.4); }
.btn-confirm:disabled { opacity: .35; cursor: not-allowed; }
</style>

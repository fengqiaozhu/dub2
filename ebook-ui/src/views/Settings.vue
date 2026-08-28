<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import request from '@/api/request';

interface AiConfig {
  id?: number;
  name: string;
  api_url: string;
  api_key: string;
  model: string;
  is_reasoning: boolean;
  is_active: boolean;
}

interface TtsConfig {
  id?: number;
  name: string;
  provider: 'mosi' | 'fish_audio' | 'fish_audio_self_hosted';
  api_url: string;
  api_key: string;
  model: string;
  is_active: boolean;
}

interface FishModelCatalog {
  models: string[];
  defaultModel?: string;
  freeDefaultModel?: string | null;
  recommendedModel?: string;
  source?: string;
  warning?: string;
}

const activeTab = ref<'ai' | 'tts'>('ai');

// AI Configs State
const aiConfigs = ref<AiConfig[]>([]);
const loadingAi = ref(false);
const showAiModal = ref(false);
const editingConfig = ref<AiConfig | null>(null);
const aiForm = ref<AiConfig>({
  name: '',
  api_url: '',
  api_key: '',
  model: '',
  is_reasoning: false,
  is_active: false
});
const isSavingAi = ref(false);

// TTS Configs State
const ttsConfigs = ref<TtsConfig[]>([]);
const loadingTts = ref(false);
const showTtsModal = ref(false);
const editingTtsConfig = ref<TtsConfig | null>(null);
const ttsForm = ref<TtsConfig>({
  name: '',
  provider: 'mosi',
  api_url: '',
  api_key: '',
  model: '',
  is_active: false
});
const isSavingTts = ref(false);
const fishModelOptions = ref<string[]>(['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1']);
const fishModelSource = ref('内置建议');
const isLoadingFishModels = ref(false);

// System Settings State omitted

// Notification State
const toast = ref<{ show: boolean; message: string; type: 'success' | 'error' } | null>(null);

const showToast = (message: string, type: 'success' | 'error' = 'success') => {
  toast.value = { show: true, message, type };
  setTimeout(() => {
    if (toast.value) toast.value.show = false;
  }, 3000);
};

// API Fetching
const fetchAiConfigs = async () => {
  loadingAi.value = true;
  try {
    const res = await request.get('/settings/ai');
    aiConfigs.value = (res as any).data || [];
  } catch (error: any) {
    showToast(error.message || '获取 AI 配置失败', 'error');
  } finally {
    loadingAi.value = false;
  }
};

const fetchTtsConfigs = async () => {
  loadingTts.value = true;
  try {
    const res = await request.get('/settings/tts');
    ttsConfigs.value = (res as any).data || [];
  } catch (error: any) {
    showToast(error.message || '获取 TTS 配置失败', 'error');
  } finally {
    loadingTts.value = false;
  }
};

const fetchFishModels = async (refresh = false) => {
  if (isLoadingFishModels.value) return;
  isLoadingFishModels.value = true;
  try {
    const res: any = await request.get('/settings/tts/fish-audio/models', {
      params: refresh ? { refresh: 'true' } : undefined,
    });
    const catalog: FishModelCatalog = res.data || {};
    if (Array.isArray(catalog.models) && catalog.models.length > 0) {
      fishModelOptions.value = catalog.models;
    }
    fishModelSource.value = catalog.source === 'fish_openapi'
      ? 'Fish 官方 OpenAPI'
      : catalog.source === 'stale_cache'
        ? '官方列表缓存'
        : '内置建议';
    if (ttsForm.value.provider === 'fish_audio' && !ttsForm.value.model.trim()) {
      ttsForm.value.model = catalog.recommendedModel || catalog.defaultModel || fishModelOptions.value[0] || '';
    }
    if (refresh) {
      showToast(catalog.warning ? `已使用${fishModelSource.value}：${catalog.warning}` : 'Fish 模型建议已刷新');
    }
  } catch (error: any) {
    if (refresh) showToast(error.message || '刷新 Fish 模型建议失败', 'error');
  } finally {
    isLoadingFishModels.value = false;
  }
};

// fetchSystemSettings omitted

// AI Modal handlers
const openAddAiModal = () => {
  editingConfig.value = null;
  aiForm.value = {
    name: '',
    api_url: '',
    api_key: '',
    model: '',
    is_reasoning: false,
    is_active: false
  };
  showAiModal.value = true;
};

const openEditAiModal = (config: AiConfig) => {
  editingConfig.value = config;
  aiForm.value = { ...config };
  showAiModal.value = true;
};

const closeAiModal = () => {
  showAiModal.value = false;
  editingConfig.value = null;
};

// AI Config CRUD
const saveAiConfig = async () => {
  if (!aiForm.value.name.trim() || !aiForm.value.api_url.trim() || !aiForm.value.api_key.trim() || !aiForm.value.model.trim()) {
    showToast('所有带星号的字段都为必填项', 'error');
    return;
  }

  isSavingAi.value = true;
  try {
    if (editingConfig.value && editingConfig.value.id) {
      await request.put(`/settings/ai/${editingConfig.value.id}`, aiForm.value);
      showToast('AI 配置修改成功');
    } else {
      await request.post('/settings/ai', aiForm.value);
      showToast('AI 配置创建成功');
    }
    closeAiModal();
    await fetchAiConfigs();
  } catch (error: any) {
    showToast(error.message || '保存 AI 配置失败', 'error');
  } finally {
    isSavingAi.value = false;
  }
};

const deleteAiConfig = async (id: number) => {
  if (!confirm('确定要永久删除此条 AI 配置吗？')) return;
  try {
    await request.delete(`/settings/ai/${id}`);
    showToast('AI 配置已删除');
    await fetchAiConfigs();
  } catch (error: any) {
    showToast(error.message || '删除失败', 'error');
  }
};

const activateAiConfig = async (id: number) => {
  try {
    await request.post(`/settings/ai/${id}/active`);
    showToast('配置已成功激活');
    await fetchAiConfigs();
  } catch (error: any) {
    showToast(error.message || '激活失败', 'error');
  }
};

// TTS Modal handlers
const openAddTtsModal = () => {
  editingTtsConfig.value = null;
  ttsForm.value = {
    name: '',
    provider: 'mosi',
    api_url: '',
    api_key: '',
    model: '',
    is_active: false
  };
  showTtsModal.value = true;
};

const openEditTtsModal = (config: TtsConfig) => {
  editingTtsConfig.value = config;
  ttsForm.value = { ...config, model: config.model || '' };
  showTtsModal.value = true;
  if (config.provider === 'fish_audio') void fetchFishModels();
};

const closeTtsModal = () => {
  showTtsModal.value = false;
  editingTtsConfig.value = null;
};

// TTS Config CRUD
const saveTtsConfig = async () => {
  if (!ttsForm.value.name.trim() || !ttsForm.value.provider) {
    showToast('配置展示名称与服务商为必填项', 'error');
    return;
  }
  if (ttsForm.value.provider === 'fish_audio' && !ttsForm.value.model.trim()) {
    showToast('Fish Audio 模型为必填项', 'error');
    return;
  }

  isSavingTts.value = true;
  try {
    if (editingTtsConfig.value && editingTtsConfig.value.id) {
      await request.put(`/settings/tts/${editingTtsConfig.value.id}`, ttsForm.value);
      showToast('TTS 配置修改成功');
    } else {
      await request.post('/settings/tts', ttsForm.value);
      showToast('TTS 配置创建成功');
    }
    closeTtsModal();
    await fetchTtsConfigs();
  } catch (error: any) {
    showToast(error.message || '保存 TTS 配置失败', 'error');
  } finally {
    isSavingTts.value = false;
  }
};

watch(
  () => ttsForm.value.provider,
  (provider) => {
    if (provider === 'fish_audio') {
      void fetchFishModels();
      return;
    }
    ttsForm.value.model = '';
  }
);

const deleteTtsConfig = async (id: number) => {
  if (!confirm('确定要永久删除此条 TTS 配置吗？')) return;
  try {
    await request.delete(`/settings/tts/${id}`);
    showToast('TTS 配置已删除');
    await fetchTtsConfigs();
  } catch (error: any) {
    showToast(error.message || '删除失败', 'error');
  }
};

const activateTtsConfig = async (id: number) => {
  try {
    await request.post(`/settings/tts/${id}/active`);
    showToast('TTS 配置已成功激活');
    await fetchTtsConfigs();
  } catch (error: any) {
    showToast(error.message || '激活失败', 'error');
  }
};

onMounted(() => {
  fetchAiConfigs();
  fetchTtsConfigs();
});
</script>

<template>
  <div class="settings-page">
    <!-- Header -->
    <div class="page-header">
      <div class="header-title">
        <h2>系统配置</h2>
        <span class="header-subtitle mono-text">
          CONFIGURATION // AI ENGINES & TTS PROVIDERS
        </span>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-nav">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'ai' }" 
        @click="activeTab = 'ai'"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        AI 大模型配置
      </button>
      
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'tts' }" 
        @click="activeTab = 'tts'"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
          <polyline points="2 12 12 17 22 12"/>
        </svg>
        TTS 语音平台配置
      </button>

      <!-- system tab omitted -->
    </div>

    <!-- Active view area -->
    <div class="content-panel animate-fade-in">
      
      <!-- TAB 1: AI Configs -->
      <div v-if="activeTab === 'ai'" class="tab-content-ai animate-fade-in">
        <div class="panel-section-header">
          <div>
            <h3>AI API 密钥与模型列表</h3>
            <p>支持配置多个兼容 OpenAI 协议的大模型服务（如 DeepSeek、SiliconFlow、Ollama 等）。您可以为每套 API 分别管理推理与常规参数，并激活其中任意一条。</p>
          </div>
          <button class="btn btn-primary glow-effect-cyan" @click="openAddAiModal">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加 AI 配置
          </button>
        </div>

        <!-- AI Configs List -->
        <div class="loading-overlay-inline" v-if="loadingAi">
          <div class="spinner"></div>
          <span class="mono-text">数据载入中...</span>
        </div>

        <div class="empty-state" v-else-if="aiConfigs.length === 0">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h3>暂无 AI 模型配置</h3>
          <p>请点击上方“添加 AI 配置”添加第一个大模型密钥。如暂无配置，系统会自动回退使用环境变量配置。</p>
        </div>

        <div class="ai-config-grid" v-else>
          <div 
            class="ai-card" 
            v-for="config in aiConfigs" 
            :key="config.id"
            :class="{ active: config.is_active }"
          >
            <div class="ai-card-glow" v-if="config.is_active"></div>
            <div class="ai-card-header">
              <div class="ai-card-info">
                <h4>{{ config.name }}</h4>
                <span class="model-badge mono-text">{{ config.model }}</span>
              </div>
              <div class="ai-status-badge" :class="{ active: config.is_active }">
                <span class="status-dot"></span>
                {{ config.is_active ? '已激活' : '待命' }}
              </div>
            </div>

            <div class="ai-card-details">
              <div class="detail-row">
                <span class="label">API URL:</span>
                <span class="value select-text">{{ config.api_url }}</span>
              </div>
              <div class="detail-row">
                <span class="label">API KEY:</span>
                <span class="value select-text">••••••••••••••••</span>
              </div>
              <div class="detail-row">
                <span class="label">模型类型:</span>
                <span class="value">
                  <span class="type-badge" :class="config.is_reasoning ? 'reasoning' : 'normal'">
                    {{ config.is_reasoning ? '深度推理(Thinking)' : '常规分析' }}
                  </span>
                </span>
              </div>
            </div>

            <div class="ai-card-actions">
              <button 
                v-if="!config.is_active" 
                class="btn btn-outline btn-sm glow-effect" 
                @click="config.id && activateAiConfig(config.id)"
              >
                设为默认激活
              </button>
              <div class="actions-group-right">
                <button class="icon-action-btn" title="编辑" @click="openEditAiModal(config)">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="icon-action-btn delete" title="删除" @click="config.id && deleteAiConfig(config.id)">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: TTS Configs -->
      <div v-if="activeTab === 'tts'" class="tab-content-tts animate-fade-in">
        <div class="panel-section-header">
          <div>
            <h3>TTS 语音平台 API 密钥列表</h3>
            <p>支持配置多个魔音 (Mosi)、Fish Audio 在线及 Fish Audio 自部署的密钥与地址参数。每个服务商只能有一个生效配置；音色管理、余额查询、克隆和配音会统一使用它。</p>
          </div>
          <button class="btn btn-primary glow-effect-cyan" @click="openAddTtsModal">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加 TTS 配置
          </button>
        </div>

        <div class="loading-overlay-inline" v-if="loadingTts">
          <div class="spinner"></div>
          <span class="mono-text">数据载入中...</span>
        </div>

        <div class="empty-state" v-else-if="ttsConfigs.length === 0">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          </div>
          <h3>暂无 TTS 平台配置</h3>
          <p>请点击上方“添加 TTS 配置”为魔音或 Fish Audio 配置 API 密钥。仅当某类服务从未创建过数据库配置时，系统才会显示并使用其环境变量兼容配置。</p>
        </div>

        <div class="ai-config-grid" v-else>
          <div 
            class="ai-card" 
            v-for="config in ttsConfigs" 
            :key="config.id"
            :class="{ active: config.is_active }"
          >
            <div class="ai-card-glow" v-if="config.is_active"></div>
            <div class="ai-card-header">
              <div class="ai-card-info">
                <h4>{{ config.name }}</h4>
                <span class="model-badge mono-text" style="text-transform: uppercase;">
                  {{ config.provider === 'mosi' ? '魔音 (Mosi)' : config.provider === 'fish_audio' ? 'Fish Audio 在线' : 'Fish 自部署' }}
                </span>
              </div>
              <div class="ai-status-badge" :class="{ active: config.is_active }">
                <span class="status-dot"></span>
                {{ config.is_active ? '已激活' : '待命' }}
              </div>
            </div>

            <div class="ai-card-details">
              <div class="detail-row" v-if="config.api_url">
                <span class="label">服务器地址:</span>
                <span class="value select-text">{{ config.api_url }}</span>
              </div>
              <div class="detail-row" v-if="config.api_key">
                <span class="label">API KEY:</span>
                <span class="value select-text">••••••••••••••••</span>
              </div>
              <div class="detail-row" v-if="config.model">
                <span class="label">模型:</span>
                <span class="value select-text mono-text">{{ config.model }}</span>
              </div>
            </div>

            <div class="ai-card-actions">
              <button 
                v-if="!config.is_active" 
                class="btn btn-outline btn-sm glow-effect" 
                @click="config.id && activateTtsConfig(config.id)"
              >
                设为激活配置
              </button>
              <div class="actions-group-right">
                <button class="icon-action-btn" title="编辑" @click="openEditTtsModal(config)">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="icon-action-btn delete" title="删除" @click="config.id && deleteTtsConfig(config.id)">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: System settings (Local env overrides) omitted -->

    </div>

    <!-- AI Config Edit/Add Modal -->
    <div class="modal-backdrop" v-if="showAiModal" @click.self="closeAiModal">
      <form class="manual-book-dialog animate-modal" @submit.prevent="saveAiConfig">
        <div class="dialog-header">
          <div>
            <h3>{{ editingConfig ? '编辑 AI 配置' : '添加 AI 配置' }}</h3>
            <span class="mono-text">AI API KEY & MODEL DETAILS</span>
          </div>
          <button type="button" class="icon-btn" @click="closeAiModal" aria-label="关闭">×</button>
        </div>

        <label class="field">
          <span>配置展示名称 <em>*</em></span>
          <input v-model="aiForm.name" type="text" placeholder="输入易于识别的名字，如 SiliconFlow-Reasoner" required>
        </label>

        <label class="field">
          <span>API 基础地址 (Base URL) <em>*</em></span>
          <input v-model="aiForm.api_url" type="url" placeholder="例如: https://api.deepseek.com/v1" required>
        </label>

        <label class="field">
          <span>API 密钥 (API Key) <em>*</em></span>
          <input v-model="aiForm.api_key" type="password" placeholder="sk-••••••••" required>
        </label>

        <label class="field">
          <span>模型名称 (Model) <em>*</em></span>
          <input v-model="aiForm.model" type="text" placeholder="例如: deepseek-reasoner 或 gpt-4o" required>
        </label>

        <div class="switch-field">
          <div class="switch-info">
            <span class="switch-title">思维链推理模型支持</span>
            <span class="switch-desc">如果是深度推理型模型（如 DeepSeek-R1、o1），请开启。系统将自动添加推理专用参数，并在返回时剔除思考链内容。</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="aiForm.is_reasoning">
            <span class="slider"></span>
          </label>
        </div>

        <div class="switch-field">
          <div class="switch-info">
            <span class="switch-title">立即激活并设为默认</span>
            <span class="switch-desc">创建或保存后，立即将该大模型参数作为后台章节提取对白的全局默认接口。</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="aiForm.is_active">
            <span class="slider"></span>
          </label>
        </div>

        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="closeAiModal">取消</button>
          <button type="submit" class="btn btn-primary glow-effect-cyan" :disabled="isSavingAi">
            {{ isSavingAi ? '保存中...' : '确认保存' }}
          </button>
        </div>
      </form>
    </div>

    <!-- TTS Config Edit/Add Modal -->
    <div class="modal-backdrop" v-if="showTtsModal" @click.self="closeTtsModal">
      <form class="manual-book-dialog animate-modal" @submit.prevent="saveTtsConfig">
        <div class="dialog-header">
          <div>
            <h3>{{ editingTtsConfig ? '编辑 TTS 配置' : '添加 TTS 配置' }}</h3>
            <span class="mono-text">TTS API KEY & ENDPOINT DETAILS</span>
          </div>
          <button type="button" class="icon-btn" @click="closeTtsModal" aria-label="关闭">×</button>
        </div>

        <label class="field">
          <span>配置展示名称 <em>*</em></span>
          <input v-model="ttsForm.name" type="text" placeholder="输入易于识别的名字，如 魔音工作室主密钥" required>
        </label>

        <label class="field">
          <span>服务提供商 (Provider) <em>*</em></span>
          <select v-model="ttsForm.provider" class="filter-select" style="width: 100%; border-radius: var(--radius-sm);" required>
            <option value="mosi">魔音 (Mosi) 在线音色服务</option>
            <option value="fish_audio">Fish Audio 在线高保真克隆</option>
            <option value="fish_audio_self_hosted">Fish Audio 本地自部署服务器</option>
          </select>
        </label>

        <label class="field" v-if="ttsForm.provider === 'mosi' || ttsForm.provider === 'fish_audio_self_hosted'">
          <span>服务器地址 (API Base URL) <em v-if="ttsForm.provider === 'fish_audio_self_hosted'">*</em></span>
          <input 
            v-model="ttsForm.api_url" 
            type="url" 
            :placeholder="ttsForm.provider === 'mosi' ? '例如: https://studio.mosi.cn (可选)' : '例如: http://127.0.0.1:8080 (必填)'" 
            :required="ttsForm.provider === 'fish_audio_self_hosted'"
          >
        </label>

        <label class="field" v-if="ttsForm.provider === 'mosi' || ttsForm.provider === 'fish_audio'">
          <span>API 密钥 (API Key) <em>*</em></span>
          <input v-model="ttsForm.api_key" type="password" placeholder="输入 API KEY" required>
        </label>

        <div class="field" v-if="ttsForm.provider === 'fish_audio'">
          <div class="field-title-row">
            <span>模型名称 (Model) <em>*</em></span>
            <button
              type="button"
              class="inline-action"
              :disabled="isLoadingFishModels"
              @click="fetchFishModels(true)"
            >
              {{ isLoadingFishModels ? '刷新中...' : '刷新官方建议' }}
            </button>
          </div>
          <input
            v-model="ttsForm.model"
            type="text"
            list="fish-model-options"
            placeholder="例如: s2.1-pro-free；也可手动输入未来模型"
            autocomplete="off"
            required
          >
          <datalist id="fish-model-options">
            <option v-for="model in fishModelOptions" :key="model" :value="model" />
          </datalist>
          <span class="field-hint">
            建议来源：{{ fishModelSource }}。下拉项仅作建议，手动输入的模型会原样传给 Fish，不会回退到旧模型。
          </span>
        </div>

        <div class="switch-field">
          <div class="switch-info">
            <span class="switch-title">立即激活并设为默认</span>
            <span class="switch-desc">创建或保存后，立即将该语音平台参数作为该服务商的全局默认接口。</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="ttsForm.is_active">
            <span class="slider"></span>
          </label>
        </div>

        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="closeTtsModal">取消</button>
          <button type="submit" class="btn btn-primary glow-effect-cyan" :disabled="isSavingTts">
            {{ isSavingTts ? '保存中...' : '确认保存' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Beautiful Modern Toast Notification -->
    <Transition name="toast">
      <div 
        class="toast-notification" 
        :class="toast.type" 
        v-if="toast && toast.show"
      >
        <span class="toast-icon">
          <svg v-if="toast.type === 'success'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 1000px;
  margin: 0 auto;
  padding-bottom: var(--space-4);
  position: relative;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title h2 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
  background: linear-gradient(135deg, var(--text-primary) 30%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 1px;
}

/* Tabs styles */
.tabs-nav {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 2px;
}

.tab-btn {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  background: none;
  border: none;
  cursor: pointer;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  color: var(--accent-cyan);
  border-bottom-color: var(--accent-cyan);
}

/* Content Area */
.content-panel {
  background-color: rgba(24, 24, 27, 0.4);
  backdrop-filter: blur(15px);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  min-height: 400px;
  position: relative;
}

.panel-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.panel-section-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.panel-section-header p {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 650px;
  line-height: 1.5;
}

/* AI Config Cards Grid */
.ai-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-3);
}

.ai-card {
  background: rgba(30, 30, 35, 0.45);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  position: relative;
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.ai-card.active {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 20px rgba(0, 212, 170, 0.05);
}

.ai-card-glow {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, var(--accent-cyan), #00ffd5);
  box-shadow: 0 1px 8px var(--accent-cyan);
}

.ai-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.ai-card-info h4 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.model-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.ai-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
}

.ai-status-badge.active {
  background: rgba(0, 212, 170, 0.08);
  border-color: rgba(0, 212, 170, 0.2);
  color: var(--accent-cyan);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
}

.ai-status-badge.active .status-dot {
  background: var(--accent-cyan);
  box-shadow: 0 0 6px var(--accent-cyan);
}

.ai-card-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.15);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
}

.detail-row {
  display: flex;
  font-size: 12px;
  line-height: 1.4;
  justify-content: space-between;
}

.detail-row .label {
  color: var(--text-muted);
}

.detail-row .value {
  color: var(--text-secondary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.type-badge.reasoning {
  background: rgba(168, 85, 247, 0.1);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.15);
}

.type-badge.normal {
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.15);
}

.ai-card-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding-top: 12px;
}

.actions-group-right {
  display: flex;
  gap: 4px;
}

.icon-action-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  background: none;
  border: none;
  cursor: pointer;
}

.icon-action-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.icon-action-btn.delete:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

/* System Form elements */
.system-settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-grid-three {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-3);
}

.form-card {
  background: rgba(30, 30, 35, 0.4);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

.card-header-simple {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--space-3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 12px;
}

.card-header-simple h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-2);
}

.field-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.inline-action {
  border: 0;
  background: transparent;
  color: var(--accent-cyan);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.inline-action:hover:not(:disabled) {
  text-decoration: underline;
}

.inline-action:disabled {
  color: var(--text-muted);
  cursor: wait;
}

.field span {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.field em {
  color: #ef4444;
  font-style: normal;
  margin-left: 2px;
}

.field input,
.field textarea,
.field select {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 13px;
  transition: all 0.2s;
}

.field select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 12px center;
  background-repeat: no-repeat;
  background-size: 16px;
  padding-right: 32px;
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 2px rgba(0, 212, 170, 0.1);
}

.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.field-hint code {
  font-family: var(--font-mono);
  background: rgba(255, 255, 255, 0.03);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--text-secondary);
}

/* Modals dialog */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.manual-book-dialog {
  background: rgba(24, 24, 27, 0.95);
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  width: 100%;
  max-width: 500px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: 90vh;
  overflow-y: auto;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}

.dialog-header h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.dialog-header span {
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.icon-btn {
  font-size: 20px;
  color: var(--text-muted);
  line-height: 1;
  background: none;
  border: none;
  cursor: pointer;
}

.icon-btn:hover {
  color: var(--text-primary);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
  border-top: 1px solid var(--border-color);
  padding-top: var(--space-3);
}

/* Switch fields */
.switch-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  gap: var(--space-4);
}

.switch-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.switch-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.switch-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Toggle Switch slider */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 34px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: var(--text-muted);
  transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--accent-cyan);
  border-color: var(--accent-cyan);
}

input:checked + .slider:before {
  transform: translateX(20px);
  background-color: var(--bg-base);
}

/* Global utility classes matching visual library */
.btn {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
  cursor: pointer;
}

.btn-sm {
  padding: 5px 12px;
  font-size: 11px;
}

.btn-outline {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background-color: transparent;
}

.btn-outline:hover {
  border-color: var(--border-focus);
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.02);
}

.btn-primary {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}

.btn-primary:hover {
  background-color: var(--accent-cyan-hover);
  transform: translateY(-1px);
}

.glow-effect {
  box-shadow: 0 0 0 transparent;
}

.glow-effect:hover {
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.05);
}

.glow-effect-cyan:hover {
  box-shadow: 0 0 12px rgba(0, 212, 170, 0.35);
}

.loading-overlay-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  gap: var(--space-2);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(0, 212, 170, 0.1);
  border-top-color: var(--accent-cyan);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px var(--space-4);
  text-align: center;
  gap: 12px;
}

.empty-state-icon {
  color: var(--text-muted);
  margin-bottom: 4px;
}

.empty-state h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-state p {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 320px;
  line-height: 1.5;
}

/* Dynamic toast notifications */
.toast-notification {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 12px 18px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  z-index: 2000;
  border: 1px solid transparent;
}

.toast-notification.success {
  background-color: rgba(6, 78, 59, 0.85);
  border-color: rgba(16, 185, 129, 0.2);
  color: #a7f3d0;
  backdrop-filter: blur(10px);
}

.toast-notification.error {
  background-color: rgba(127, 29, 29, 0.85);
  border-color: rgba(239, 68, 68, 0.2);
  color: #fecaca;
  backdrop-filter: blur(10px);
}

.toast-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.toast-message {
  font-size: 13px;
  font-weight: 500;
}

/* Animations */
.animate-fade-in {
  animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.animate-modal {
  animation: modalIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.95) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Transitions */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.95);
}
</style>

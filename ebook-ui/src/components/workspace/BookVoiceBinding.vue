<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import VoicePickerModal from './VoicePickerModal.vue';

const workspaceStore = useWorkspaceStore();

const isSaving = ref<Record<string, boolean>>({});
const isDeleting = ref<Record<string, boolean>>({});

// 弹窗状态
const pickerVisible = ref(false);
const pickerTargetRole = ref('');

onMounted(() => {
  workspaceStore.fetchVoices();
});

const bookCharacters = computed(() => workspaceStore.bookCharacters);
const allVoicesFlat = computed(() => workspaceStore.allVoicesFlat);

// 当前章节出现的角色名集合，用于标注"本章"
const currentChapterRoles = computed(() => new Set(workspaceStore.currentChapterRoles));

const getSelectedVoice = (characterName: string) => {
  return workspaceStore.getVoiceForRole(characterName) || null;
};

const getVoiceName = (characterName: string, voiceId: string | null) => {
  const binding = workspaceStore.getVoiceBindingForRole(characterName);
  if (binding?.display_name) return binding.display_name;
  if (!voiceId) return null;
  const found = allVoicesFlat.value.find((v) => v.id === voiceId && v.provider === (binding?.provider || 'mosi'));
  return found?.name || voiceId;
};

// 打开弹窗
const openPicker = (characterName: string) => {
  pickerTargetRole.value = characterName;
  pickerVisible.value = true;
};

// 确认选择音色
const onVoiceSelected = async (binding: any) => {
  const characterName = pickerTargetRole.value;
  isSaving.value[characterName] = true;
  try {
    await workspaceStore.saveVoiceBinding(characterName, binding);
  } finally {
    isSaving.value[characterName] = false;
  }
};

const removeVoiceBinding = async (characterName: string) => {
  isDeleting.value[characterName] = true;
  try {
    await workspaceStore.deleteVoiceBinding(characterName);
  } finally {
    isDeleting.value[characterName] = false;
  }
};

const getAvatarColor = (name: string) => {
  const colors = ['#00d4aa', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};
</script>

<template>
  <div class="book-voice-container">
    <div class="panel-header">
      <h3 class="panel-title">全书音色绑定</h3>
      <span class="role-count mono-text">ROLES {{ bookCharacters.length }}</span>
    </div>

    <!-- 角色列表 -->
    <div class="character-list" v-if="bookCharacters.length > 0">
      <div
        class="character-item"
        v-for="char in bookCharacters"
        :key="char.character_name"
        :class="{ 'is-current-chapter': currentChapterRoles.has(char.character_name) }"
      >
        <!-- 角色信息行 -->
        <div class="char-info">
          <div class="avatar" :style="{ backgroundColor: getAvatarColor(char.character_name) }">
            {{ char.character_name.charAt(0) }}
          </div>
          <div class="char-meta">
            <span class="char-name">{{ char.character_name }}</span>
            <div class="char-badges">
              <span class="badge mono-text" v-if="char.character_name === '旁白'">全文旁白</span>
              <template v-else>
                <span class="badge mono-text">{{ char.dialogue_count }} 对白</span>
                <span class="badge mono-text">{{ char.chapter_count }} 章</span>
              </template>
              <span class="badge badge-current mono-text" v-if="currentChapterRoles.has(char.character_name)">
                本章
              </span>
            </div>
          </div>
        </div>

        <!-- 已绑定状态 -->
        <div class="voice-bound" v-if="getSelectedVoice(char.character_name)">
          <div class="bound-info">
            <span class="bound-icon">◉</span>
            <span class="bound-name">{{ getVoiceName(char.character_name, getSelectedVoice(char.character_name)) }}</span>
            <span class="binding-meta mono-text">{{ workspaceStore.getVoiceBindingForRole(char.character_name)?.provider || 'mosi' }}</span>
          </div>
          <div class="bound-actions">
            <button
              class="change-btn mono-text"
              @click="openPicker(char.character_name)"
              :disabled="isSaving[char.character_name]"
              title="更换音色"
            >
              更换
            </button>
            <button
              class="unbind-btn mono-text"
              @click="removeVoiceBinding(char.character_name)"
              :disabled="isDeleting[char.character_name]"
              title="解绑音色"
            >
              {{ isDeleting[char.character_name] ? '…' : '×' }}
            </button>
          </div>
        </div>

        <!-- 未绑定：按钮触发弹窗 -->
        <div class="voice-unbound" v-else>
          <button
            class="pick-btn"
            @click="openPicker(char.character_name)"
            :disabled="isSaving[char.character_name]"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <circle cx="12" cy="12" r="9"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            {{ isSaving[char.character_name] ? '保存中…' : '选择音色' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else>
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="var(--border-focus)" stroke-width="1.5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <p>暂无角色</p>
      <span class="empty-hint mono-text">请先对章节进行 AI 解析</span>
    </div>

    <!-- 音色选择弹窗 -->
    <VoicePickerModal
      :visible="pickerVisible"
      :title="pickerTargetRole"
      :selected-voice-id="getSelectedVoice(pickerTargetRole)"
      :book-id="workspaceStore.activeBookId"
      @select="onVoiceSelected"
      @close="pickerVisible = false"
    />
  </div>
</template>

<style scoped>
.book-voice-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.panel-header {
  height: 48px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-panel);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.role-count {
  font-size: 10px;
  color: var(--accent-cyan);
}

.character-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.character-item {
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  transition: border-color 0.2s;
}

.character-item.is-current-chapter {
  border-color: rgba(0, 212, 170, 0.3);
}

.char-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  flex-shrink: 0;
}

.char-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.char-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.char-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background-color: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.badge-current {
  background-color: rgba(0, 212, 170, 0.15);
  color: var(--accent-cyan);
}

/* ── 已绑定状态行 ─────────────────────────── */
.voice-bound {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background-color: rgba(0, 212, 170, 0.06);
  border: 1px solid rgba(0, 212, 170, 0.2);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
}

.bound-info {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
}

.bound-icon {
  font-size: 8px;
  color: var(--accent-cyan);
  flex-shrink: 0;
}

.bound-name {
  font-size: 12px;
  color: var(--accent-cyan);
  font-weight: 500;
  flex: 1 1 auto;
  min-width: 4em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.binding-meta {
  flex: 0 1 46%;
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.bound-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.change-btn {
  padding: 2px 8px;
  height: 22px;
  background: transparent;
  border: 1px solid rgba(0, 212, 170, 0.35);
  border-radius: var(--radius-sm);
  color: var(--accent-cyan);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}

.change-btn:hover:not(:disabled) {
  background-color: rgba(0, 212, 170, 0.12);
}

.change-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.unbind-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(0, 212, 170, 0.3);
  border-radius: 50%;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.18s;
  line-height: 1;
  padding: 0;
}

.unbind-btn:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
  color: #ef4444;
}

.unbind-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 未绑定：选择按钮 ─────────────────────── */
.voice-unbound {
  width: 100%;
}

.pick-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: 1px dashed rgba(245, 158, 11, 0.45);
  border-radius: var(--radius-sm);
  color: #f59e0b;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s;
}

.pick-btn:hover:not(:disabled) {
  background-color: rgba(245, 158, 11, 0.07);
  border-color: rgba(245, 158, 11, 0.7);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.15);
}

.pick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 空状态 ───────────────────────────────── */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: 13px;
  padding: var(--space-4);
  text-align: center;
}

.empty-hint {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}
</style>

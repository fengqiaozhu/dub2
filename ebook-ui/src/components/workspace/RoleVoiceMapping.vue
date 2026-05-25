<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import VoicePickerModal from './VoicePickerModal.vue';

const workspaceStore = useWorkspaceStore();

const isSaving = ref<Record<string, boolean>>({});

// 弹窗状态
const pickerVisible = ref(false);
const pickerTargetRole = ref('');

onMounted(() => {
  // 复用 store 统一管理的音色列表
  workspaceStore.fetchVoices();
});

// 当前章节角色列表（AI 解析后才有数据）
const uniqueRoles = computed(() => workspaceStore.currentChapterRoles);

const getSelectedVoice = (role: string) => {
  return workspaceStore.getVoiceForRole(role) || null;
};

const getVoiceName = (role: string) => {
  return workspaceStore.getVoiceNameForRole(role);
};

// 打开弹窗
const openPicker = (role: string) => {
  pickerTargetRole.value = role;
  pickerVisible.value = true;
};

const toggleHighlightedRole = (role: string) => {
  workspaceStore.setHighlightedRole(workspaceStore.highlightedRole === role ? null : role);
};

// 确认选择音色
const onVoiceSelected = async (binding: any) => {
  const role = pickerTargetRole.value;
  isSaving.value[role] = true;
  try {
    await workspaceStore.saveVoiceBinding(role, binding);
  } finally {
    isSaving.value[role] = false;
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
  <div class="role-mapping-container">
    <div class="panel-header">
      <h3 class="panel-title">章节角色绑定</h3>
      <span class="role-count mono-text">ROLES {{ uniqueRoles.length }}</span>
    </div>

    <div class="mapping-list" v-if="uniqueRoles.length > 0">
      <div
        class="mapping-item"
        :class="{
          'is-bound': getSelectedVoice(role),
          'is-unbound': !getSelectedVoice(role),
          'is-highlighted': workspaceStore.highlightedRole === role
        }"
        v-for="role in uniqueRoles"
        :key="role"
      >
        <div class="role-info" @click="toggleHighlightedRole(role)" style="cursor: pointer;">
          <div class="avatar" :style="{ backgroundColor: getAvatarColor(role) }">
            {{ role.charAt(0) }}
          </div>
          <span class="role-name">{{ role }}</span>
          <!-- 状态 badge -->
          <span class="status-badge bound-badge" v-if="getSelectedVoice(role)">已绑定</span>
          <span class="status-badge unbound-badge" v-else>
            <span class="unbound-pulse"></span>未绑定
          </span>
        </div>

        <!-- 已绑定状态：显示音色名 + 操作按钮 -->
        <div class="bound-row" v-if="getSelectedVoice(role)">
          <div class="bound-info">
            <span class="bound-dot">◉</span>
            <span class="bound-name">{{ getVoiceName(role) }}</span>
            <span class="binding-meta mono-text">{{ workspaceStore.getVoiceBindingForRole(role)?.provider || 'mosi' }}</span>
          </div>
          <button
            class="change-btn mono-text"
            @click="openPicker(role)"
            :disabled="isSaving[role]"
            title="更换音色"
          >
            {{ isSaving[role] ? '…' : '更换' }}
          </button>
        </div>

        <!-- 未绑定：按钮触发弹窗 -->
        <div class="unbound-row" v-else>
          <button
            class="pick-btn"
            @click="openPicker(role)"
            :disabled="isSaving[role]"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <circle cx="12" cy="12" r="9"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            {{ isSaving[role] ? '保存中…' : '选择音色' }}
          </button>
        </div>
      </div>
    </div>

    <div class="empty-state" v-else>
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--border-focus)" stroke-width="1.5">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <p>当前章节无角色</p>
      <span class="empty-hint mono-text">请先执行 AI 解析</span>
    </div>

    <!-- 音色选择弹窗 -->
    <VoicePickerModal
      :visible="pickerVisible"
      :title="pickerTargetRole"
      :selected-voice-id="getSelectedVoice(pickerTargetRole)"
      @select="onVoiceSelected"
      @close="pickerVisible = false"
    />
  </div>
</template>

<style scoped>
.role-mapping-container {
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

.mapping-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mapping-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
}

/* 已绑定：青色边框 */
.mapping-item.is-bound {
  border-color: rgba(0, 212, 170, 0.25);
  background-color: rgba(0, 212, 170, 0.03);
}

/* 未绑定：橙色警示边框 + 轻微背景 */
.mapping-item.is-unbound {
  border-color: rgba(245, 158, 11, 0.45);
  background-color: rgba(245, 158, 11, 0.05);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.15);
}

.mapping-item.is-unbound:hover {
  border-color: rgba(245, 158, 11, 0.7);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
}

/* 高亮选中状态 */
.mapping-item.is-highlighted {
  border-color: rgba(0, 212, 170, 0.6);
  background-color: rgba(0, 212, 170, 0.08);
  box-shadow: 0 0 10px rgba(0, 212, 170, 0.2);
}

.mapping-item.is-highlighted .role-name {
  color: var(--accent-cyan);
}

.role-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  flex-shrink: 0;
}

.role-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

/* 状态 badge */
.status-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.bound-badge {
  background-color: rgba(0, 212, 170, 0.12);
  color: var(--accent-cyan);
  border: 1px solid rgba(0, 212, 170, 0.3);
}

.unbound-badge {
  background-color: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.4);
}

/* 未绑定状态小脉冲圆点 */
.unbound-pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: #f59e0b;
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}

/* ── 已绑定状态行 ─────────────────────────────────────────── */
.bound-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
  background-color: rgba(0, 212, 170, 0.06);
  border: 1px solid rgba(0, 212, 170, 0.2);
  border-radius: var(--radius-sm);
}

.bound-info {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
}

.bound-dot {
  font-size: 8px;
  color: var(--accent-cyan);
  flex-shrink: 0;
}

.bound-name {
  font-size: 11px;
  color: var(--accent-cyan);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.change-btn {
  padding: 2px 8px;
  height: 20px;
  background: transparent;
  border: 1px solid rgba(0, 212, 170, 0.35);
  border-radius: var(--radius-sm);
  color: var(--accent-cyan);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
  flex-shrink: 0;
}

.change-btn:hover:not(:disabled) {
  background-color: rgba(0, 212, 170, 0.12);
}

.change-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 未绑定：选择按钮 ─────────────────────────────────────── */
.unbound-row {
  width: 100%;
}

.pick-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
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

/* ── 空状态 ───────────────────────────────────────────────── */
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

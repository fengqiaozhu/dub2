<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { CharacterProfile, PronunciationRule } from '@/stores/workspaceStore';
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

// ==================== 角色档案 / 别名 / 读音规则 ====================

const expandedRole = ref<string | null>(null);
const profileBusy = ref<Record<number, boolean>>({});
const profileImpactsLoading = ref<Record<number, boolean>>({});
const aliasText = ref<Record<number, string>>({});
const panelError = ref<Record<number, string>>({});
const ruleBusy = ref<Record<number, boolean>>({});
const ruleForms = ref<Record<number, { type: 'alias' | 'phoneme'; match: string; replacement: string }>>({});

const profiles = computed(() => workspaceStore.characterProfiles as CharacterProfile[]);

const profileFor = (name: string): CharacterProfile | null =>
  profiles.value.find((p) => p.canonical_name === name) || null;

const profileRules = (profileId: number): PronunciationRule[] =>
  workspaceStore.pronunciationRules.filter(
    (rule) => Number(rule.profile_id) === Number(profileId)
  );

const profileRuleCount = (characterName: string): number => {
  const profile = profileFor(characterName);
  return profile ? profileRules(profile.id).length : 0;
};

const panelsFor = (characterName: string): CharacterProfile[] => {
  const profile = profileFor(characterName);
  return profile ? [profile] : [];
};

const profileImpactText = (profile: CharacterProfile) => {
  if (profileImpactsLoading.value[profile.id]) return '统计中…';
  if (profile.impact) return `影响 ${profile.impact.dialogue_count} 句 / ${profile.impact.chapter_count} 章`;
  return '';
};

// 展开档案面板：懒加载影响面与读音规则
const toggleProfile = async (characterName: string) => {
  if (expandedRole.value === characterName) {
    expandedRole.value = null;
    return;
  }
  const profile = profileFor(characterName);
  if (!profile) return;
  expandedRole.value = characterName;
  const bookId = workspaceStore.activeBookId;
  if (!bookId) return;
  if (!profile.impact && !profileImpactsLoading.value[profile.id]) {
    profileImpactsLoading.value[profile.id] = true;
    try {
      await workspaceStore.fetchProfileImpact(bookId, profile.id);
    } finally {
      profileImpactsLoading.value[profile.id] = false;
    }
  }
  await workspaceStore.ensurePronunciationRules();
};

const addAlias = async (profile: CharacterProfile) => {
  const bookId = workspaceStore.activeBookId;
  if (!bookId) return;
  const value = (aliasText.value[profile.id] || '').trim();
  if (!value) return;
  profileBusy.value[profile.id] = true;
  panelError.value[profile.id] = '';
  try {
    await workspaceStore.addCharacterAlias(bookId, profile.id, value);
    aliasText.value[profile.id] = '';
  } catch (err: any) {
    panelError.value[profile.id] = err?.message || '新增别名失败';
  } finally {
    profileBusy.value[profile.id] = false;
  }
};

const removeAlias = async (profile: CharacterProfile, aliasId: number) => {
  const bookId = workspaceStore.activeBookId;
  if (!bookId) return;
  profileBusy.value[profile.id] = true;
  panelError.value[profile.id] = '';
  try {
    await workspaceStore.deleteCharacterAlias(bookId, profile.id, aliasId);
  } catch (err) {
    panelError.value[profile.id] = '删除别名失败';
  } finally {
    profileBusy.value[profile.id] = false;
  }
};

const getRuleForm = (profileId: number) => {
  if (!ruleForms.value[profileId]) {
    ruleForms.value[profileId] = { type: 'alias', match: '', replacement: '' };
  }
  return ruleForms.value[profileId];
};

const saveRule = async (profile: CharacterProfile) => {
  const bookId = workspaceStore.activeBookId;
  if (!bookId) return;
  const form = getRuleForm(profile.id);
  const matchText = (form.match || '').trim();
  if (!matchText) return;
  ruleBusy.value[profile.id] = true;
  panelError.value[profile.id] = '';
  try {
    await workspaceStore.createPronunciationRule(bookId, {
      profile_id: profile.id,
      rule_type: form.type,
      match_text: matchText,
      replacement: (form.replacement || '').trim()
    });
    ruleForms.value[profile.id] = { type: form.type, match: '', replacement: '' };
  } catch (err: any) {
    panelError.value[profile.id] = err?.message || '新增规则失败';
  } finally {
    ruleBusy.value[profile.id] = false;
  }
};

const toggleRule = async (rule: PronunciationRule) => {
  const bookId = workspaceStore.activeBookId;
  if (!bookId) return;
  ruleBusy.value[rule.id] = true;
  try {
    await workspaceStore.setPronunciationRuleEnabled(bookId, rule.id, !rule.enabled);
  } catch (err) {
    console.error('Failed to toggle rule:', err);
  } finally {
    ruleBusy.value[rule.id] = false;
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

        <!-- 档案 / 别名 / 读音规则 -->
        <div class="profile-block" v-if="profileFor(char.character_name)">
          <button
            type="button"
            class="profile-toggle mono-text"
            @click="toggleProfile(char.character_name)"
          >
            <span class="chev">{{ expandedRole === char.character_name ? '▾' : '▸' }}</span>
            档案 · 别名 {{ profileFor(char.character_name)?.aliases?.length || 0 }} · 规则 {{ profileRuleCount(char.character_name) }}
          </button>
          <div class="profile-panel" v-if="expandedRole === char.character_name">
            <div class="profile-panel-inner" v-for="item in panelsFor(char.character_name)" :key="'profile-' + item.id">
              <div class="panel-error mono-text" v-if="panelError[item.id]">{{ panelError[item.id] }}</div>
              <div class="impact-line mono-text" v-if="profileImpactText(item)">{{ profileImpactText(item) }}</div>

              <div class="alias-row">
                <span class="alias-chip" v-for="alias in item.aliases" :key="alias.id">
                  {{ alias.alias }}
                  <button
                    type="button"
                    class="alias-delete"
                    @click="removeAlias(item, alias.id)"
                    :disabled="profileBusy[item.id]"
                    title="删除别名"
                  >×</button>
                </span>
                <span class="alias-empty mono-text" v-if="!item.aliases?.length">暂无别名</span>
              </div>

              <div class="alias-add">
                <input
                  class="alias-input"
                  v-model="aliasText[item.id]"
                  placeholder="新增别名"
                  @keyup.enter="addAlias(item)"
                />
                <button
                  type="button"
                  class="alias-add-btn mono-text"
                  @click="addAlias(item)"
                  :disabled="profileBusy[item.id]"
                >{{ profileBusy[item.id] ? '…' : '添加' }}</button>
              </div>

              <div class="rules-block">
                <div class="section-label mono-text">读音规则</div>
                <div class="rule-item" v-for="rule in profileRules(item.id)" :key="rule.id" :class="{ disabled: !rule.enabled }">
                  <button
                    type="button"
                    class="rule-state mono-text"
                    :class="{ off: !rule.enabled }"
                    @click="toggleRule(rule)"
                    :disabled="ruleBusy[rule.id]"
                    :title="rule.enabled ? '停用规则' : '启用规则'"
                  >{{ rule.enabled ? '启用' : '停用' }}</button>
                  <span class="rule-type mono-text" :class="{ phoneme: rule.rule_type === 'phoneme' }">{{ rule.rule_type }}</span>
                  <span class="rule-text">{{ rule.match_text }} → {{ rule.replacement || '（原文）' }}</span>
                  <span class="rule-impact mono-text">影响 {{ rule.impact ? rule.impact.dialogue_count : '…' }} 句</span>
                </div>
                <div class="rule-empty mono-text" v-if="!profileRules(item.id).length">该角色暂无规则</div>

                <div class="rule-create">
                  <select v-model="getRuleForm(item.id).type" class="rule-select mono-text">
                    <option value="alias">alias</option>
                    <option value="phoneme">phoneme（仅保存，当前供应商不发送）</option>
                  </select>
                  <input
                    class="rule-input"
                    v-model="getRuleForm(item.id).match"
                    placeholder="匹配文本"
                    @keyup.enter="saveRule(item)"
                  />
                  <input
                    class="rule-input"
                    v-model="getRuleForm(item.id).replacement"
                    placeholder="替换为（可选）"
                    @keyup.enter="saveRule(item)"
                  />
                  <button
                    type="button"
                    class="rule-save mono-text"
                    @click="saveRule(item)"
                    :disabled="ruleBusy[item.id]"
                  >{{ ruleBusy[item.id] ? '保存中…' : '保存规则' }}</button>
                </div>
                <p class="phoneme-hint mono-text" v-if="getRuleForm(item.id).type === 'phoneme'">
                  phoneme 规则仅保存，当前供应商不会发送。
                </p>
              </div>
            </div>
          </div>
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

/* ── 档案 / 别名 / 读音规则 ───────────────── */
.profile-block {
  border-top: 1px dashed var(--border-color);
  padding-top: var(--space-2);
}

.profile-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  letter-spacing: 0.03em;
  text-align: left;
}

.profile-toggle:hover {
  color: var(--accent-cyan);
}

.chev {
  font-size: 9px;
  flex-shrink: 0;
}

.profile-panel {
  margin-top: var(--space-2);
  background-color: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.panel-error {
  font-size: 10px;
  color: #ef4444;
}

.impact-line {
  font-size: 10px;
  color: var(--accent-cyan);
}

.alias-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.alias-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 1px 4px 1px 6px;
}

.alias-delete {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.alias-delete:hover:not(:disabled) {
  color: #ef4444;
  background-color: rgba(239, 68, 68, 0.15);
}

.alias-delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.alias-empty {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.alias-add {
  display: flex;
  gap: 4px;
}

.alias-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}

.alias-input:focus {
  border-color: var(--border-focus);
}

.alias-add-btn {
  height: 22px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid rgba(0, 212, 170, 0.35);
  border-radius: var(--radius-sm);
  color: var(--accent-cyan);
  font-size: 11px;
  cursor: pointer;
}

.alias-add-btn:hover:not(:disabled) {
  background-color: rgba(0, 212, 170, 0.12);
}

.alias-add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.section-label {
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
}

.rules-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rule-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-primary);
}

.rule-item.disabled .rule-text {
  color: var(--text-muted);
  text-decoration: line-through;
}

.rule-state {
  flex-shrink: 0;
  width: 34px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: 1px solid rgba(0, 212, 170, 0.35);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 9px;
  cursor: pointer;
}

.rule-state.off {
  border-color: var(--border-color);
  color: var(--text-muted);
}

.rule-state:hover:not(:disabled) {
  background-color: rgba(0, 212, 170, 0.12);
}

.rule-state:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rule-type {
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background-color: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.rule-type.phoneme {
  background-color: rgba(139, 92, 246, 0.18);
  color: #a78bfa;
}

.rule-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.rule-impact {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--text-muted);
}

.rule-empty {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.rule-create {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.rule-select {
  height: 22px;
  padding: 0 4px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 10px;
  outline: none;
  flex-shrink: 0;
}

.rule-input {
  flex: 1;
  min-width: 5em;
  height: 22px;
  padding: 0 6px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}

.rule-input:focus, .rule-select:focus {
  border-color: var(--border-focus);
}

.rule-save {
  height: 22px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid rgba(0, 212, 170, 0.35);
  border-radius: var(--radius-sm);
  color: var(--accent-cyan);
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}

.rule-save:hover:not(:disabled) {
  background-color: rgba(0, 212, 170, 0.12);
}

.rule-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.phoneme-hint {
  margin: 0;
  font-size: 9px;
  color: #a78bfa;
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

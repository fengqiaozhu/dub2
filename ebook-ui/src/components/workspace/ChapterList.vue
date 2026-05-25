<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import request from '@/api/request';

const props = defineProps<{
  bookTitle?: string;
  chapters: any[];
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const workspaceStore = useWorkspaceStore();
const showEditor = ref(false);
const isSaving = ref(false);
const editingChapterId = ref<number | null>(null);
const deleteConfirmVisible = ref(false);
const chapterForm = ref({
  title: '',
  content: '',
});

const selectChapter = (id: number) => {
  workspaceStore.setActiveChapter(id);
};

const openCreate = () => {
  editingChapterId.value = null;
  chapterForm.value = {
    title: `第 ${props.chapters.length + 1} 章`,
    content: '',
  };
  showEditor.value = true;
};

const openEdit = async () => {
  if (!workspaceStore.activeChapterId) return;
  try {
    const res = await request.get(`/chapters/${workspaceStore.activeChapterId}`);
    chapterForm.value = {
      title: res.data?.title || '',
      content: res.data?.content || '',
    };
    editingChapterId.value = workspaceStore.activeChapterId;
    showEditor.value = true;
  } catch (error) {
    console.error('Failed to load chapter for editing:', error);
  }
};

const closeEditor = () => {
  showEditor.value = false;
  editingChapterId.value = null;
  chapterForm.value = { title: '', content: '' };
};

const saveChapter = async () => {
  if (!workspaceStore.activeBookId || !chapterForm.value.content.trim()) return;
  isSaving.value = true;
  try {
    if (editingChapterId.value) {
      await request.put(`/chapters/${editingChapterId.value}`, {
        title: chapterForm.value.title.trim() || '未命名章节',
        content: chapterForm.value.content,
      });
      await workspaceStore.setActiveChapter(editingChapterId.value);
    } else {
      const res = await request.post(`/books/${workspaceStore.activeBookId}/chapters`, {
        title: chapterForm.value.title.trim() || `第 ${props.chapters.length + 1} 章`,
        content: chapterForm.value.content,
      });
      const chapterId = res.data?.id;
      if (chapterId) {
        await workspaceStore.setActiveChapter(chapterId);
      }
    }
    emit('refresh');
    closeEditor();
  } catch (error) {
    console.error('Failed to save chapter:', error);
  } finally {
    isSaving.value = false;
  }
};

const deleteActiveChapter = async () => {
  if (!workspaceStore.activeChapterId) return;
  deleteConfirmVisible.value = true;
};

const confirmDeleteActiveChapter = async () => {
  if (!workspaceStore.activeChapterId) return;
  try {
    await request.delete(`/chapters/${workspaceStore.activeChapterId}`);
    await workspaceStore.setActiveChapter(null);
    emit('refresh');
    deleteConfirmVisible.value = false;
  } catch (error) {
    console.error('Failed to delete chapter:', error);
  }
};
</script>

<template>
  <div class="chapter-list-container">
    <div class="panel-header">
      <h3 class="panel-title">章节列表</h3>
      <div class="header-actions">
        <button class="icon-btn" title="新增章节" @click="openCreate">+</button>
        <button class="icon-btn" title="编辑当前章节" :disabled="!workspaceStore.activeChapterId" @click="openEdit">✎</button>
        <button class="icon-btn danger" title="删除当前章节" :disabled="!workspaceStore.activeChapterId" @click="deleteActiveChapter">×</button>
        <span class="chapter-count mono-text">CH {{ chapters.length }}</span>
      </div>
    </div>
    
    <div class="book-info">
      <h4 class="book-name">{{ bookTitle || '加载中...' }}</h4>
    </div>
    
    <div class="chapter-scroll">
      <ul class="chapter-list">
        <li 
          v-for="chapter in chapters" 
          :key="chapter.id"
          class="chapter-item"
          :class="{ active: workspaceStore.activeChapterId === chapter.id }"
          @click="selectChapter(chapter.id)"
        >
          <div class="chapter-meta mono-text">
            <span class="chapter-index">{{ String(chapter.chapter_index).padStart(2, '0') }}</span>
          </div>
          <span class="chapter-title" :title="chapter.title">{{ chapter.title }}</span>
          <!-- Mocking duration or status indicator -->
          <div class="chapter-status mono-text">
            <span class="dot" :class="{ 'analyzed': chapter.ai_analysis }"></span>
          </div>
        </li>
      </ul>
    </div>

    <div class="modal-backdrop" v-if="showEditor" @click.self="closeEditor">
      <form class="chapter-dialog" @submit.prevent="saveChapter">
        <div class="dialog-header">
          <div>
            <h3>{{ editingChapterId ? '编辑章节' : '新增章节' }}</h3>
            <span class="mono-text">CHAPTER ENTRY</span>
          </div>
          <button type="button" class="icon-btn" @click="closeEditor" aria-label="关闭">×</button>
        </div>

        <label class="field">
          <span>章节标题</span>
          <input v-model="chapterForm.title" type="text" placeholder="章节标题" autofocus>
        </label>

        <label class="field">
          <span>正文</span>
          <textarea v-model="chapterForm.content" rows="16" placeholder="粘贴或输入章节正文" />
        </label>

        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="closeEditor">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="isSaving || !chapterForm.content.trim()">
            {{ isSaving ? '保存中...' : '保存章节' }}
          </button>
        </div>
      </form>
    </div>

    <div class="modal-backdrop" v-if="deleteConfirmVisible" @click.self="deleteConfirmVisible = false">
      <div class="chapter-dialog confirm-dialog">
        <div class="dialog-header">
          <div>
            <h3>删除章节</h3>
            <span class="mono-text">DESTRUCTIVE ACTION</span>
          </div>
          <button type="button" class="icon-btn" @click="deleteConfirmVisible = false" aria-label="关闭">×</button>
        </div>
        <p class="confirm-message">确定删除当前章节吗？相关角色、对白和音频记录也会一起删除。</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="deleteConfirmVisible = false">取消</button>
          <button type="button" class="btn btn-danger" @click="confirmDeleteActiveChapter">删除章节</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chapter-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  height: 48px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-color);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-title {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.chapter-count {
  font-size: 10px;
  color: var(--accent-cyan);
}

.icon-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.icon-btn:hover:not(:disabled) {
  color: var(--accent-cyan);
  border-color: var(--accent-cyan);
}

.icon-btn.danger:hover:not(:disabled) {
  color: #ef4444;
  border-color: #ef4444;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.book-info {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-input);
}

.book-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chapter-scroll {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) 0;
}

.chapter-item {
  display: flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  transition: all 0.2s;
  gap: var(--space-2);
}

.chapter-item:hover {
  background-color: var(--bg-panel-hover);
}

.chapter-item.active {
  background-color: rgba(0, 212, 170, 0.1);
  color: var(--accent-cyan);
}

.chapter-item.active .chapter-index,
.chapter-item.active .chapter-title {
  color: var(--accent-cyan);
}

.chapter-meta {
  color: var(--text-muted);
  font-size: 11px;
  width: 20px;
}

.chapter-title {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chapter-status {
  display: flex;
  align-items: center;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--border-focus);
}

.dot.analyzed {
  background-color: var(--accent-cyan);
  box-shadow: 0 0 4px var(--accent-cyan);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  background-color: rgba(0, 0, 0, 0.62);
}

.chapter-dialog {
  width: min(760px, 100%);
  max-height: calc(100vh - 64px);
  overflow: auto;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  box-shadow: var(--shadow-md);
}

.dialog-header,
.dialog-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}

.dialog-header {
  margin-bottom: var(--space-3);
}

.dialog-header h3 {
  font-size: 18px;
  margin-bottom: 2px;
}

.dialog-header span {
  font-size: 10px;
  color: var(--text-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-2);
}

.field span {
  color: var(--text-secondary);
  font-size: 12px;
}

.field input,
.field textarea {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 13px;
  resize: vertical;
}

.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--accent-cyan);
}

.dialog-actions {
  justify-content: flex-end;
  margin-top: var(--space-3);
}

.btn {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.btn-outline {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.btn-primary {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}

.btn-danger {
  background-color: #ef4444;
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.confirm-dialog {
  width: min(420px, 100%);
}

.confirm-message {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
</style>

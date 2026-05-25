<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { parseBookTags, resolveBookCoverUrl, useBookStore, type Book } from '@/stores/bookStore';

const props = defineProps<{
  book: Book | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const bookStore = useBookStore();

const form = ref({
  title: '',
  author: '',
  description: '',
  language: '',
  tags: [] as string[],
  publisher: '',
  publish_year: null as number | null,
  isbn: '',
});

const tagInput = ref('');
const coverFile = ref<File | null>(null);
const coverPreview = ref('');
const saving = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

// Sync form with book prop
watch(() => props.visible, (val) => {
  if (val && props.book) {
    form.value = {
      title: props.book.title || '',
      author: props.book.author || '',
      description: props.book.description || '',
      language: props.book.language || '',
      tags: parseBookTags(props.book.tags),
      publisher: props.book.publisher || '',
      publish_year: props.book.publish_year || null,
      isbn: props.book.isbn || '',
    };
    coverPreview.value = resolveBookCoverUrl(props.book.cover_url);
    coverFile.value = null;
  }
});

const canSave = computed(() => form.value.title.trim().length > 0);

const addTag = () => {
  const raw = tagInput.value.trim();
  if (!raw) return;
  const newTags = raw.split(/[,，]/).map(t => t.trim()).filter(Boolean);
  for (const tag of newTags) {
    if (!form.value.tags.includes(tag)) {
      form.value.tags.push(tag);
    }
  }
  tagInput.value = '';
};

const handleTagKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTag();
  }
};

const removeTag = (index: number) => {
  form.value.tags.splice(index, 1);
};

const handleCoverSelect = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    coverFile.value = target.files[0];
    coverPreview.value = URL.createObjectURL(target.files[0]);
  }
};

const handleSave = async () => {
  if (!props.book || !canSave.value) return;
  saving.value = true;

  try {
    const data: Record<string, any> = {
      title: form.value.title.trim(),
      author: form.value.author.trim() || null,
      description: form.value.description.trim() || null,
      language: form.value.language || null,
      tags: form.value.tags.length > 0 ? JSON.stringify(form.value.tags) : null,
      publisher: form.value.publisher.trim() || null,
      publish_year: form.value.publish_year || null,
      isbn: form.value.isbn.trim() || null,
    };

    await bookStore.updateBookMetadata(props.book.id, data);

    if (coverFile.value) {
      await bookStore.uploadCover(props.book.id, coverFile.value);
    }

    emit('saved');
    emit('close');
  } catch (error) {
    console.error('Failed to save metadata:', error);
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="modal-backdrop" v-if="visible" @click.self="$emit('close')">
    <div class="metadata-dialog">
      <div class="dialog-header">
        <div>
          <h3>书籍信息</h3>
          <span class="mono-text">METADATA EDITOR</span>
        </div>
        <button type="button" class="icon-btn" @click="$emit('close')" aria-label="关闭">×</button>
      </div>

      <form @submit.prevent="handleSave" class="metadata-form">
        <!-- Basic Info -->
        <div class="form-section">
          <div class="section-label mono-text">基本信息</div>

          <label class="field">
            <span>书名 <em>*</em></span>
            <input v-model="form.title" type="text" placeholder="输入书名" />
          </label>

          <label class="field">
            <span>作者</span>
            <input v-model="form.author" type="text" placeholder="输入作者名" />
          </label>

          <label class="field">
            <span>简介</span>
            <textarea v-model="form.description" rows="4" placeholder="输入书籍简介" />
          </label>
        </div>

        <!-- Publishing Info -->
        <div class="form-section">
          <div class="section-label mono-text">出版信息</div>

          <div class="field-row">
            <label class="field">
              <span>出版社</span>
              <input v-model="form.publisher" type="text" placeholder="出版社" />
            </label>
            <label class="field" style="max-width: 140px;">
              <span>出版年份</span>
              <input v-model.number="form.publish_year" type="number" min="1900" max="2099" placeholder="年份" />
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span>ISBN</span>
              <input v-model="form.isbn" type="text" placeholder="ISBN" />
            </label>
            <label class="field" style="max-width: 180px;">
              <span>语言</span>
              <select v-model="form.language">
                <option value="">未指定</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </label>
          </div>
        </div>

        <!-- Tags -->
        <div class="form-section">
          <div class="section-label mono-text">标签</div>
          <div class="tags-container">
            <div class="tags-list" v-if="form.tags.length > 0">
              <span class="tag-pill" v-for="(tag, index) in form.tags" :key="index">
                {{ tag }}
                <button type="button" class="tag-remove" @click="removeTag(index)">×</button>
              </span>
            </div>
            <div class="tag-input-row">
              <input 
                v-model="tagInput" 
                type="text" 
                placeholder="输入标签，按回车或逗号添加"
                @keydown="handleTagKeydown"
                @blur="addTag"
              />
            </div>
          </div>
        </div>

        <!-- Cover -->
        <div class="form-section">
          <div class="section-label mono-text">封面</div>
          <div class="cover-upload-area" @click="fileInputRef?.click()">
            <img v-if="coverPreview" :src="coverPreview" class="cover-preview" alt="封面预览" />
            <div v-else class="cover-upload-placeholder">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span>点击上传封面图片</span>
            </div>
            <input 
              ref="fileInputRef"
              type="file" 
              accept="image/*" 
              style="display:none" 
              @change="handleCoverSelect"
            />
          </div>
        </div>

        <!-- Actions -->
        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="$emit('close')">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="saving || !canSave">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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

.metadata-dialog {
  width: min(680px, 100%);
  max-height: calc(100vh - 64px);
  overflow: auto;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  box-shadow: var(--shadow-md);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
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

.icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.metadata-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.form-section {
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-color);
  margin-bottom: var(--space-1);
}

.form-section:last-of-type {
  border-bottom: none;
}

.section-label {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 1px;
  margin-bottom: 12px;
  text-transform: uppercase;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-2);
  flex: 1;
}

.field span {
  color: var(--text-secondary);
  font-size: 12px;
}

.field span em {
  color: #ef4444;
  font-style: normal;
}

.field input,
.field textarea,
.field select {
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
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: var(--accent-cyan);
}

.field select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 8px center;
  background-repeat: no-repeat;
  background-size: 20px;
  padding-right: 32px;
}

.field select option {
  background-color: var(--bg-panel);
  color: var(--text-primary);
}

.field-row {
  display: flex;
  gap: var(--space-2);
}

/* Tags */
.tags-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background-color: rgba(0, 212, 170, 0.1);
  color: var(--accent-cyan);
  font-size: 12px;
  font-family: var(--font-mono);
  border: 1px solid rgba(0, 212, 170, 0.2);
}

.tag-remove {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1;
  padding: 0 2px;
}

.tag-remove:hover {
  color: #ef4444;
}

.tag-input-row input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 13px;
}

.tag-input-row input:focus {
  outline: none;
  border-color: var(--accent-cyan);
}

/* Cover */
.cover-upload-area {
  width: 160px;
  height: 220px;
  border: 1px dashed var(--border-focus);
  border-radius: var(--radius-md);
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-upload-area:hover {
  border-color: var(--accent-cyan);
  background-color: var(--bg-input);
}

.cover-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: var(--space-2);
}

/* Actions */
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
}

.btn {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-outline {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.btn-outline:hover {
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

.btn-primary {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}

.btn-primary:hover {
  background-color: var(--accent-cyan-hover);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>

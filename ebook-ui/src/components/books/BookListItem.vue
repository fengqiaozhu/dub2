<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { parseBookTags, resolveBookCoverUrl, type Book } from '@/stores/bookStore';

const props = defineProps<{
  book: Book;
}>();

const emit = defineEmits<{
  (e: 'edit', book: Book): void;
  (e: 'delete', book: Book): void;
}>();

const router = useRouter();

const chapterCount = computed(() => {
  if (typeof props.book.chapter_count === 'number') return props.book.chapter_count;
  return props.book.chapters ? props.book.chapters.length : 0;
});

const formatLabel = computed(() => {
  const fmt = props.book.format?.toUpperCase() || '';
  if (fmt === 'MANUAL') return '手动';
  return fmt;
});

const formattedDate = computed(() => {
  if (!props.book.created_at) return '';
  const d = new Date(props.book.created_at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
});

const isParsing = computed(() => props.book.status === 'parsing');
const coverUrl = computed(() => resolveBookCoverUrl(props.book.cover_url));
const tags = computed(() => parseBookTags(props.book.tags).slice(0, 3));

const goToWorkspace = () => {
  if (!isParsing.value) {
    router.push(`/workspace/${props.book.id}`);
  }
};

const handleEdit = (e: Event) => {
  e.stopPropagation();
  emit('edit', props.book);
};

const handleDelete = (e: Event) => {
  e.stopPropagation();
  emit('delete', props.book);
};
</script>

<template>
  <div class="book-list-item" :class="{ 'is-parsing': isParsing }" @click="goToWorkspace">
    <!-- Cover thumbnail -->
    <div class="item-cover">
      <img v-if="coverUrl" :src="coverUrl" :alt="book.title" class="cover-thumb" />
      <div v-else class="cover-thumb-placeholder">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
      </div>
    </div>

    <!-- Title & Author -->
    <div class="item-main">
      <h4 class="item-title" :title="book.title">{{ book.title }}</h4>
      <span class="item-author">{{ book.author || '未知作者' }}</span>
    </div>

    <!-- Chapters -->
    <div class="item-chapters mono-text">
      {{ chapterCount }} 章
    </div>

    <div class="item-tags" :class="{ empty: tags.length === 0 }">
      <span v-for="tag in tags" :key="tag" class="tag-chip">{{ tag }}</span>
      <span v-if="tags.length === 0" class="tag-empty mono-text">无标签</span>
    </div>

    <!-- Format badge -->
    <div class="item-format">
      <span class="format-tag mono-text">{{ formatLabel }}</span>
    </div>

    <!-- Date -->
    <div class="item-date mono-text">
      {{ formattedDate }}
    </div>

    <!-- Actions -->
    <div class="item-actions">
      <button class="action-btn" @click="handleEdit" title="编辑信息">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="action-btn danger" @click="handleDelete" title="删除">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.book-list-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 12px var(--space-2);
  border-radius: var(--radius-md);
  transition: all 0.15s ease;
  cursor: pointer;
  border: 1px solid transparent;
}

.book-list-item:hover {
  background-color: var(--bg-panel);
  border-color: var(--border-color);
}

.book-list-item.is-parsing {
  opacity: 0.7;
}

.item-cover {
  flex-shrink: 0;
  width: 40px;
  height: 56px;
  border-radius: 4px;
  overflow: hidden;
  background-color: #202025;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-thumb-placeholder {
  color: var(--border-focus);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.item-author {
  font-size: 12px;
  color: var(--text-muted);
}

.item-chapters {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  min-width: 60px;
  text-align: center;
}

.item-tags {
  flex-shrink: 0;
  width: 150px;
  display: flex;
  gap: 4px;
  overflow: hidden;
}

.item-tags.empty {
  justify-content: center;
}

.tag-chip {
  max-width: 46px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background-color: rgba(0, 212, 170, 0.08);
  border: 1px solid rgba(0, 212, 170, 0.18);
  color: var(--text-secondary);
}

.tag-empty {
  color: var(--text-muted);
  font-size: 11px;
}

.item-format {
  flex-shrink: 0;
  min-width: 50px;
  text-align: center;
}

.format-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.item-date {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  min-width: 90px;
  text-align: center;
}

.item-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.book-list-item:hover .item-actions {
  opacity: 1;
}

.action-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: all 0.15s;
}

.action-btn:hover {
  background-color: var(--bg-panel-hover);
  color: var(--text-primary);
}

.action-btn.danger:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
</style>

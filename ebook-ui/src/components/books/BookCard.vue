<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { resolveBookCoverUrl, type Book } from '@/stores/bookStore';

const props = defineProps<{
  book: Book;
}>();

const emit = defineEmits<{
  (e: 'edit', book: Book): void;
  (e: 'delete', book: Book): void;
}>();

const chapterCount = computed(() => {
  if (typeof props.book.chapter_count === 'number') return props.book.chapter_count;
  return props.book.chapters ? props.book.chapters.length : 0;
});

const isParsing = computed(() => props.book.status === 'parsing');
const isDone = computed(() => props.book.status === 'done');
const isError = computed(() => props.book.status === 'error');

const progressStyle = computed(() => {
  return { width: `${props.book.progress || 0}%` };
});

const formatLabel = computed(() => {
  const fmt = props.book.format?.toUpperCase() || '';
  if (fmt === 'MANUAL') return 'MAN';
  return fmt;
});

const coverUrl = computed(() => resolveBookCoverUrl(props.book.cover_url));

const showMenu = ref(false);

const router = useRouter();

const goToWorkspace = () => {
  if (!isParsing.value) {
    router.push(`/workspace/${props.book.id}`);
  }
};

const toggleMenu = (e: Event) => {
  e.stopPropagation();
  showMenu.value = !showMenu.value;
};

const handleEdit = (e: Event) => {
  e.stopPropagation();
  showMenu.value = false;
  emit('edit', props.book);
};

const handleDelete = (e: Event) => {
  e.stopPropagation();
  showMenu.value = false;
  emit('delete', props.book);
};

const closeMenu = () => {
  showMenu.value = false;
};
</script>

<template>
  <div 
    class="book-card" 
    :class="{ 'is-parsing': isParsing }" 
    @click="goToWorkspace"
    @mouseleave="closeMenu"
  >
    <div class="card-cover">
      <img 
        v-if="coverUrl" 
        :src="coverUrl" 
        :alt="book.title"
        class="cover-image"
      />
      <div v-else class="cover-placeholder">
        <svg v-if="book.format === 'epub'" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        <svg v-else-if="book.format === 'txt'" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
      </div>
      
      <!-- Format label (top-left) -->
      <div class="format-badge" v-if="formatLabel">{{ formatLabel }}</div>

      <!-- Status badge (top-right) -->
      <div class="status-badge" v-if="isParsing">
        <span class="pulse"></span> 解析中
      </div>
      <div class="status-badge done" v-else-if="isDone">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        完成
      </div>
      <div class="status-badge error" v-else-if="isError">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        错误
      </div>

      <!-- Menu button -->
      <button class="menu-trigger" @click="toggleMenu" title="更多操作">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <circle cx="12" cy="6" r="1.5"/>
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="12" cy="18" r="1.5"/>
        </svg>
      </button>
      <div class="dropdown-menu" v-if="showMenu">
        <button class="dropdown-item" @click="handleEdit">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          编辑信息
        </button>
        <button class="dropdown-item danger" @click="handleDelete">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          删除
        </button>
      </div>
    </div>
    
    <div class="card-info">
      <h4 class="book-title" :title="book.title">{{ book.title }}</h4>
      <div class="book-meta mono-text">
        <span class="book-author">{{ book.author || '未知作者' }}</span>
        <span class="separator">·</span>
        <span class="chapter-count">{{ chapterCount }} 章</span>
      </div>
    </div>
    
    <div class="progress-bar-container" v-if="isParsing">
      <div class="progress-bar" :style="progressStyle"></div>
    </div>
    <div class="progress-bar-container done" v-else-if="isDone">
      <div class="progress-bar" style="width: 100%"></div>
    </div>
    <div class="progress-bar-container ready" v-else>
      <div class="progress-bar" style="width: 100%"></div>
    </div>
  </div>
</template>

<style scoped>
.book-card {
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: all 0.2s ease;
  position: relative;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

.book-card:hover {
  border-color: var(--border-focus);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.book-card.is-parsing {
  border-color: rgba(0, 212, 170, 0.3);
}

.card-cover {
  height: 180px;
  background-color: #202025;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
}

.cover-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  color: var(--border-focus);
}

.format-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  color: var(--text-secondary);
  font-size: 9px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background-color: var(--bg-base);
  color: var(--text-secondary);
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  border: 1px solid var(--border-color);
}

.status-badge.done {
  color: var(--accent-cyan);
  border-color: rgba(0, 212, 170, 0.3);
  background-color: rgba(0, 212, 170, 0.05);
}

.status-badge.error {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
  background-color: rgba(239, 68, 68, 0.05);
}

.menu-trigger {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  opacity: 0;
  transition: all 0.2s;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.book-card:hover .menu-trigger {
  opacity: 1;
}

.menu-trigger:hover {
  color: var(--text-primary);
  background-color: rgba(0, 0, 0, 0.7);
}

.dropdown-menu {
  position: absolute;
  bottom: 40px;
  right: 8px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 4px;
  min-width: 120px;
  z-index: 20;
  box-shadow: var(--shadow-md);
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition: all 0.15s;
}

.dropdown-item:hover {
  background-color: var(--bg-panel-hover);
  color: var(--text-primary);
}

.dropdown-item.danger:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.pulse {
  width: 6px;
  height: 6px;
  background-color: var(--warning-amber);
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
}

.card-info {
  padding: var(--space-2);
  flex: 1;
}

.book-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.book-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.progress-bar-container {
  height: 2px;
  background-color: var(--border-color);
  width: 100%;
}

.progress-bar {
  height: 100%;
  background-color: var(--warning-amber);
  transition: width 0.3s ease;
}

.progress-bar-container.done .progress-bar {
  background-color: var(--accent-cyan);
}

.progress-bar-container.ready .progress-bar {
  background-color: var(--border-focus);
}
</style>

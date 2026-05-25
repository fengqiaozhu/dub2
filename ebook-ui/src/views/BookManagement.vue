<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useBookStore, type Book } from '@/stores/bookStore';
import BookCard from '@/components/books/BookCard.vue';
import BookListItem from '@/components/books/BookListItem.vue';
import BookMetadataModal from '@/components/books/BookMetadataModal.vue';
import request from '@/api/request';

const bookStore = useBookStore();
const router = useRouter();

// Modals & Forms State
const showCreateModal = ref(false);
const isCreating = ref(false);
const createForm = ref({
  title: '',
  chapterTitle: '第一章',
  chapterContent: '',
});

// Edit & Delete State
const showEditModal = ref(false);
const editingBook = ref<Book | null>(null);
const showDeleteConfirm = ref(false);
const deletingBook = ref<Book | null>(null);

// Local control bounds (synced to store)
const searchQuery = ref(bookStore.searchQuery);
const sortBy = ref(bookStore.sortBy);
const sortOrder = ref(bookStore.sortOrder);
const formatFilter = ref(bookStore.formatFilter);
const viewMode = computed(() => bookStore.viewMode);

const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// Debounced Search Watcher
let searchTimeout: any = null;
watch(searchQuery, (newVal) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    bookStore.setSearchQuery(newVal);
    bookStore.fetchBooks();
  }, 300);
});

// Watch sorting controls
watch(sortBy, (newVal) => {
  bookStore.setSortBy(newVal);
  bookStore.fetchBooks();
});

watch(sortOrder, (newVal) => {
  bookStore.setSortOrder(newVal);
  bookStore.fetchBooks();
});

// Watch format filter
watch(formatFilter, (newVal) => {
  bookStore.setFormatFilter(newVal);
});

// Toggle sorting order
const toggleSortOrder = () => {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
};

// Toggle view mode
const setViewMode = (mode: 'grid' | 'list') => {
  bookStore.setViewMode(mode);
};

// Reset all search/filter states
const resetFilters = () => {
  searchQuery.value = '';
  formatFilter.value = null;
  sortBy.value = 'created_at';
  sortOrder.value = 'desc';
  bookStore.setSearchQuery('');
  bookStore.setFormatFilter(null);
  bookStore.setSortBy('created_at');
  bookStore.setSortOrder('desc');
  bookStore.fetchBooks();
};

// Drag and drop handlers
const handleDragEnter = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = true;
};

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
};

const handleDrop = async (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
  
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    await uploadFile(files[0]);
  }
};

const handleFileSelect = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    await uploadFile(target.files[0]);
  }
};

const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    await request.post('/books/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    // Refresh book list after upload
    await bookStore.fetchBooks();
    await bookStore.fetchBookCount();
  } catch (error) {
    console.error('Upload failed:', error);
  }
};

// Create manual book handlers
const closeCreateModal = () => {
  showCreateModal.value = false;
  createForm.value = {
    title: '',
    chapterTitle: '第一章',
    chapterContent: '',
  };
};

const createManualBook = async () => {
  const title = createForm.value.title.trim();
  const chapterContent = createForm.value.chapterContent.trim();
  if (!title) return;

  isCreating.value = true;
  try {
    const bookRes = await request.post('/books', {
      title,
      format: 'manual',
    });
    const bookId = (bookRes as any).data?.id;

    if (bookId && chapterContent) {
      await request.post(`/books/${bookId}/chapters`, {
        title: createForm.value.chapterTitle.trim() || '第一章',
        content: chapterContent,
      });
    }

    closeCreateModal();
    await bookStore.fetchBooks();
    await bookStore.fetchBookCount();
    if (bookId) {
      router.push(`/workspace/${bookId}`);
    }
  } catch (error) {
    console.error('Failed to create manual book:', error);
  } finally {
    isCreating.value = false;
  }
};

// Edit / Delete Triggers
const triggerEdit = (book: Book) => {
  editingBook.value = book;
  showEditModal.value = true;
};

const triggerDelete = (book: Book) => {
  deletingBook.value = book;
  showDeleteConfirm.value = true;
};

const confirmDelete = async () => {
  if (!deletingBook.value) return;
  try {
    await bookStore.deleteBook(deletingBook.value.id);
    showDeleteConfirm.value = false;
    deletingBook.value = null;
  } catch (error) {
    console.error('Delete failed:', error);
  }
};

onMounted(() => {
  bookStore.fetchBooks();
});
</script>

<template>
  <div class="book-management">
    <!-- Header -->
    <div class="page-header">
      <div class="header-title">
        <h2>书籍管理</h2>
        <span class="header-subtitle mono-text">
          LIBRARY // {{ bookStore.bookCount }} BOOKS // EPUB - MOBI - TXT
        </span>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline glow-effect" @click="showCreateModal = true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新建书籍
        </button>
        <button class="btn btn-primary glow-effect-cyan" @click="fileInput?.click()">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          上传书籍
        </button>
        <input 
          type="file" 
          ref="fileInput" 
          style="display: none" 
          accept=".epub,.mobi,.txt"
          @change="handleFileSelect"
        >
      </div>
    </div>
    
    <!-- Upload Drop Zone Area -->
    <div 
      class="upload-area" 
      :class="{ 'is-dragging': isDragging }"
      @dragenter="handleDragEnter"
      @dragover.prevent
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="fileInput?.click()"
    >
      <div class="upload-content">
        <div class="upload-icon-circle">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--accent-cyan)" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <polyline points="9 15 12 12 15 15"/>
          </svg>
        </div>
        <h3>拖拽文件至此 或 点击选择文件上传</h3>
        <p>支持 EPUB、MOBI、TXT · 智能切分章节 · AI 提取角色</p>
        <div class="tags mono-text">
          <span>EPUB</span>
          <span>MOBI</span>
          <span>TXT</span>
        </div>
      </div>
    </div>

    <!-- Beautiful Modern Filters & Sorting Toolbar -->
    <div class="toolbar">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--text-muted)" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="搜索书名或作者..." 
        />
        <button v-if="searchQuery" class="clear-search-btn" @click="searchQuery = ''">×</button>
      </div>
      
      <div class="controls-right">
        <!-- Format filter tabs -->
        <div class="filter-group">
          <label class="toolbar-label mono-text">格式:</label>
          <select v-model="formatFilter" class="filter-select">
            <option :value="null">全部格式</option>
            <option value="epub">EPUB</option>
            <option value="mobi">MOBI</option>
            <option value="txt">TXT</option>
            <option value="manual">手动创建</option>
          </select>
        </div>

        <!-- Sort Select & Direction button -->
        <div class="sort-group">
          <label class="toolbar-label mono-text">排序:</label>
          <select v-model="sortBy" class="filter-select">
            <option value="created_at">上传时间</option>
            <option value="title">书名</option>
            <option value="author">作者</option>
          </select>
          <button 
            class="direction-btn" 
            @click="toggleSortOrder" 
            :title="sortOrder === 'asc' ? '正序 (A-Z / 升序)' : '倒序 (Z-A / 降序)'"
          >
            <svg v-if="sortOrder === 'asc'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <polyline points="19 12 12 19 5 12"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>

        <!-- Divider -->
        <div class="toolbar-divider"></div>

        <!-- View mode switcher -->
        <div class="view-toggle">
          <button 
            class="toggle-btn" 
            :class="{ active: viewMode === 'grid' }" 
            @click="setViewMode('grid')"
            title="网格卡片视图"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button 
            class="toggle-btn" 
            :class="{ active: viewMode === 'list' }" 
            @click="setViewMode('list')"
            title="横向列表视图"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
    
    <!-- Loading State -->
    <div class="loading-overlay" v-if="bookStore.loading">
      <div class="spinner"></div>
      <span class="mono-text">数据载入中...</span>
    </div>

    <!-- Empty State -->
    <div class="empty-state" v-else-if="bookStore.filteredBooks.length === 0">
      <div class="empty-state-icon">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
          <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
      </div>
      <h3>未找到匹配的书籍</h3>
      <p>尝试更换关键词或清除格式筛选</p>
      <button class="btn btn-outline reset-btn" @click="resetFilters">重置全部筛选</button>
    </div>

    <!-- Book Grid View -->
    <div class="book-grid animate-fade-in" v-else-if="viewMode === 'grid'">
      <BookCard 
        v-for="book in bookStore.filteredBooks" 
        :key="book.id" 
        :book="book" 
        @edit="triggerEdit"
        @delete="triggerDelete"
      />
    </div>

    <!-- Book Horizontal List View -->
    <div class="book-list-container animate-fade-in" v-else-if="viewMode === 'list'">
      <!-- Header titles -->
      <div class="list-view-header mono-text">
        <div class="col-cover">封面</div>
        <div class="col-main">书名 / 作者</div>
        <div class="col-chapters">章节数</div>
        <div class="col-tags">标签</div>
        <div class="col-format">格式</div>
        <div class="col-date">创建时间</div>
        <div class="col-actions">操作</div>
      </div>
      <div class="list-view-rows">
        <BookListItem 
          v-for="book in bookStore.filteredBooks" 
          :key="book.id" 
          :book="book" 
          @edit="triggerEdit"
          @delete="triggerDelete"
        />
      </div>
    </div>

    <!-- Create Manual Book Modal -->
    <div class="modal-backdrop" v-if="showCreateModal" @click.self="closeCreateModal">
      <form class="manual-book-dialog animate-modal" @submit.prevent="createManualBook">
        <div class="dialog-header">
          <div>
            <h3>新建书籍</h3>
            <span class="mono-text">MANUAL ENTRY</span>
          </div>
          <button type="button" class="icon-btn" @click="closeCreateModal" aria-label="关闭">×</button>
        </div>

        <label class="field">
          <span>书名 <em>*</em></span>
          <input v-model="createForm.title" type="text" placeholder="输入书籍名称" autofocus required>
        </label>

        <label class="field">
          <span>首章标题</span>
          <input v-model="createForm.chapterTitle" type="text" placeholder="第一章">
        </label>

        <label class="field">
          <span>首章正文</span>
          <textarea v-model="createForm.chapterContent" rows="8" placeholder="在此输入首章的文本内容。您也可以选择先留空，创建完毕后再到工作台中编辑和添加章节。" />
        </label>

        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" @click="closeCreateModal">取消</button>
          <button type="submit" class="btn btn-primary glow-effect-cyan" :disabled="isCreating || !createForm.title.trim()">
            {{ isCreating ? '创建中...' : '创建并打开' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Edit Metadata Modal -->
    <BookMetadataModal 
      :book="editingBook" 
      :visible="showEditModal"
      @close="showEditModal = false; editingBook = null;"
      @saved="bookStore.fetchBooks()"
    />

    <!-- Gorgeous Premium Delete Confirm Dialog -->
    <div class="modal-backdrop" v-if="showDeleteConfirm" @click.self="showDeleteConfirm = false">
      <div class="delete-dialog animate-modal">
        <div class="delete-header">
          <div class="delete-warning-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ef4444" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h3>删除书籍</h3>
            <span class="mono-text">DELETION WARNING</span>
          </div>
        </div>

        <div class="delete-body">
          <p>您确定要永久删除书籍 <strong class="delete-book-title">《{{ deletingBook?.title }}》</strong> 吗？</p>
          <div class="alert-box">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="alert-icon">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>此操作不可逆，将级联删除该书籍下的<strong>所有章节、关联的角色音色绑定、音频导出文件以及历史记录</strong>！</span>
          </div>
        </div>

        <div class="delete-actions">
          <button type="button" class="btn btn-outline" @click="showDeleteConfirm = false">我再想想</button>
          <button type="button" class="btn btn-danger" @click="confirmDelete">
            确认删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-management {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 1200px;
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

.header-actions {
  display: flex;
  gap: var(--space-2);
}

.btn {
  padding: 10px var(--space-2);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
}

.btn-outline {
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background-color: transparent;
}

.btn-outline:hover {
  border-color: var(--border-focus);
  color: var(--text-primary);
  background-color: var(--bg-panel);
}

.btn-primary {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}

.btn-primary:hover {
  background-color: var(--accent-cyan-hover);
  transform: translateY(-1px);
}

.btn-danger {
  background-color: #ef4444;
  color: var(--text-primary);
}

.btn-danger:hover {
  background-color: #dc2626;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
}

.glow-effect:hover {
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.05);
}

.glow-effect-cyan:hover {
  box-shadow: 0 0 12px rgba(0, 212, 170, 0.35);
}

/* Upload Area with animations */
.upload-area {
  border: 1px dashed var(--border-focus);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-8);
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background-color: var(--bg-panel);
  position: relative;
  overflow: hidden;
}

.upload-area:hover, .upload-area.is-dragging {
  border-color: var(--accent-cyan);
  background-color: var(--bg-panel-hover);
  box-shadow: inset 0 0 20px rgba(0, 212, 170, 0.03);
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}

.upload-icon-circle {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  background-color: rgba(0, 212, 170, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  border: 1px solid rgba(0, 212, 170, 0.15);
  transition: all 0.3s ease;
}

.upload-area:hover .upload-icon-circle {
  background-color: rgba(0, 212, 170, 0.15);
  transform: translateY(-2px);
}

.upload-content h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.upload-content p {
  color: var(--text-muted);
  font-size: 12px;
}

.tags {
  display: flex;
  gap: var(--space-1);
  margin-top: 4px;
}

.tags span {
  font-size: 9px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-weight: 600;
}

/* Elegant Control Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  padding: 12px 16px;
  background-color: rgba(24, 24, 27, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 260px;
  max-width: 400px;
}

.search-icon {
  position: absolute;
  left: 12px;
}

.search-box input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  color: var(--text-primary);
  padding: 8px 36px;
  font-size: 13px;
  transition: all 0.2s;
}

.search-box input:focus {
  outline: none;
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 2px rgba(0, 212, 170, 0.1);
}

.clear-search-btn {
  position: absolute;
  right: 12px;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
}

.clear-search-btn:hover {
  color: var(--text-primary);
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-group,
.sort-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.filter-select {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  color: var(--text-secondary);
  padding: 6px 28px 6px 12px;
  font-size: 12px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 8px center;
  background-repeat: no-repeat;
  background-size: 16px;
  transition: all 0.2s;
}

.filter-select:hover,
.filter-select:focus {
  border-color: var(--border-focus);
  color: var(--text-primary);
}

.direction-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-input);
  transition: all 0.2s;
}

.direction-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-focus);
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background-color: var(--border-color);
}

.view-toggle {
  display: flex;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background-color: var(--bg-input);
}

.toggle-btn {
  width: 28px;
  height: 28px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.toggle-btn.active {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}

.toggle-btn:not(.active):hover {
  color: var(--text-primary);
  background-color: var(--bg-panel-hover);
}

/* Loading state */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) 0;
  gap: 16px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(0, 212, 170, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-cyan);
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-8) var(--space-4);
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-top: 12px;
}

.empty-state-icon {
  margin-bottom: var(--space-2);
  color: var(--text-muted);
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

.empty-state p {
  color: var(--text-muted);
  font-size: 13px;
  margin-bottom: 16px;
}

.reset-btn {
  padding: 8px 16px;
  font-size: 12px;
}

/* Grid & List View containers */
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-2);
  margin-top: 8px;
}

.book-list-container {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background-color: rgba(24, 24, 27, 0.4);
  overflow: hidden;
  margin-top: 8px;
}

.list-view-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 12px var(--space-2);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background-color: rgba(24, 24, 27, 0.8);
}

.col-cover { width: 40px; text-align: center; }
.col-main { flex: 1; }
.col-chapters { width: 60px; text-align: center; }
.col-tags { width: 150px; text-align: center; }
.col-format { width: 50px; text-align: center; }
.col-date { width: 90px; text-align: center; }
.col-actions { width: 70px; text-align: center; }

.list-view-rows {
  display: flex;
  flex-direction: column;
  divide-y: 1px solid var(--border-color);
}

.list-view-rows > :not(:last-child) {
  border-bottom: 1px solid var(--border-color);
}

/* Modals Backdrops */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  background-color: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.manual-book-dialog {
  width: min(680px, 100%);
  max-height: calc(100vh - 64px);
  overflow: auto;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  box-shadow: var(--shadow-md);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}

.dialog-header h3 {
  font-size: 18px;
  margin-bottom: 2px;
}

.dialog-header span {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.icon-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
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
  font-weight: 500;
}

.field span em {
  color: #ef4444;
  font-style: normal;
  margin-left: 2px;
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
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

/* Premium Deletion dialog */
.delete-dialog {
  width: min(460px, 100%);
  background-color: var(--bg-panel);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 16px rgba(239, 68, 68, 0.05);
}

.delete-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.delete-warning-icon {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-full);
  background-color: rgba(239, 68, 68, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(239, 68, 68, 0.15);
}

.delete-header h3 {
  font-size: 16px;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.delete-header span {
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.delete-body {
  margin-bottom: 20px;
}

.delete-body p {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 12px;
}

.delete-book-title {
  color: var(--text-primary);
}

.alert-box {
  background-color: rgba(239, 68, 68, 0.03);
  border: 1px solid rgba(239, 68, 68, 0.1);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 11px;
  color: #f87171;
  display: flex;
  gap: 8px;
  line-height: 1.4;
}

.alert-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Animations */
.animate-fade-in {
  animation: fadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.animate-modal {
  animation: modalIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.96) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBookStore } from '@/stores/bookStore';

const route = useRoute();
const bookStore = useBookStore();
const STORAGE_KEY = 'voiceforge.sidebar.collapsed';
const collapsed = ref(false);

const menuItems = computed(() => [
  { name: '书籍管理', icon: 'books', path: '/books', count: bookStore.bookCount },
  { name: '音色管理', icon: 'voices', path: '/voices' },
  { name: '工作台', icon: 'workspace', path: '/workspace' }
]);

onMounted(() => {
  collapsed.value = localStorage.getItem(STORAGE_KEY) === 'true';
  if (bookStore.books.length === 0) {
    bookStore.fetchBooks();
  }
});

watch(collapsed, (value) => {
  localStorage.setItem(STORAGE_KEY, String(value));
});
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span class="logo-text">VoiceForge <span class="logo-sub">AI-STUDIO</span></span>
    </div>

    <div class="menu-group">
      <div class="menu-label">主菜单</div>
      <nav class="nav-menu">
        <router-link 
          v-for="item in menuItems" 
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path.startsWith(item.path) }"
          :title="collapsed ? item.name : undefined"
        >
          <span class="nav-icon" aria-hidden="true">
            <svg v-if="item.icon === 'books'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <svg v-else-if="item.icon === 'voices'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/>
              <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
              <path d="M12 18v3"/>
              <path d="M8 21h8"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="14" rx="2"/>
              <path d="M8 21h8"/>
              <path d="M12 18v3"/>
              <path d="M8 9h8"/>
              <path d="M8 13h5"/>
            </svg>
          </span>
          <span class="nav-text">{{ item.name }}</span>
          <span v-if="item.count !== undefined" class="nav-badge">{{ item.count }}</span>
        </router-link>
      </nav>
    </div>

    <button
      class="collapse-btn"
      type="button"
      :title="collapsed ? '展开主菜单' : '收起主菜单'"
      :aria-label="collapsed ? '展开主菜单' : '收起主菜单'"
      @click="collapsed = !collapsed"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline v-if="collapsed" points="9 18 15 12 9 6"/>
        <polyline v-else points="15 18 9 12 15 6"/>
      </svg>
      <span class="collapse-text">收起</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px;
  background-color: var(--bg-panel);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: width 0.2s ease;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.sidebar.collapsed {
  width: 72px;
}

.logo {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-color);
  gap: var(--space-1);
  min-width: 0;
}

.logo-text {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
}

.logo-sub {
  color: var(--accent-cyan);
  font-size: 10px;
  vertical-align: super;
  margin-left: 4px;
  font-family: var(--font-mono);
}

.collapse-btn {
  height: 36px;
  margin: auto var(--space-2) var(--space-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background-color: var(--bg-input);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-shrink: 0;
  transition: all 0.2s ease;
  font-size: 12px;
}

.collapse-btn:hover {
  color: var(--accent-cyan);
  border-color: var(--accent-cyan);
}

.sidebar.collapsed .logo {
  justify-content: center;
  padding: 0;
}

.sidebar.collapsed .logo-text {
  display: none;
}

.sidebar.collapsed .logo-icon {
  display: flex;
}

.sidebar.collapsed .collapse-btn {
  width: 40px;
  margin: auto auto var(--space-3);
}

.sidebar.collapsed .collapse-text {
  display: none;
}

.menu-group {
  padding: var(--space-3) var(--space-2);
  flex: 1;
  min-height: 0;
}

.menu-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: var(--space-2);
  padding: 0 var(--space-1);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar.collapsed .menu-group {
  padding: var(--space-3) 8px;
}

.sidebar.collapsed .menu-label {
  text-align: center;
  padding: 0;
  font-size: 10px;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 14px;
  transition: all 0.2s ease;
  position: relative;
  min-height: 32px;
}

.nav-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: inherit;
}

.nav-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item:hover {
  background-color: var(--bg-panel-hover);
  color: var(--text-primary);
}

.nav-item.active {
  background-color: var(--bg-panel-active);
  color: var(--text-primary);
  font-weight: 500;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  background-color: var(--accent-cyan);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  box-shadow: 0 0 8px var(--accent-cyan);
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: var(--space-1) 0;
}

.sidebar.collapsed .nav-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.sidebar.collapsed .nav-text {
  display: none;
}

.sidebar.collapsed .nav-item.active .nav-icon {
  color: var(--accent-cyan);
}

.nav-badge {
  background-color: rgba(0, 212, 170, 0.15);
  color: var(--accent-cyan);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-weight: 600;
}

.sidebar.collapsed .nav-badge {
  position: absolute;
  right: 4px;
  top: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
}
</style>

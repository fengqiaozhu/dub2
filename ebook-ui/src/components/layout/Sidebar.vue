<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBookStore } from '@/stores/bookStore';

const route = useRoute();
const bookStore = useBookStore();
const STORAGE_KEY = 'dub.sidebar.collapsed';
const collapsed = ref(false);

const menuItems = computed(() => [
  { name: '书籍管理', icon: 'books', path: '/books', count: bookStore.bookCount },
  { name: '音色管理', icon: 'voices', path: '/voices' },
  { name: '工作台', icon: 'workspace', path: '/workspace' },
  { name: 'AI 对话', icon: 'chat', path: '/chat' },
  { name: '系统设置', icon: 'settings', path: '/settings' }
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
        <img src="/logo-mark.png" alt="dub logo">
      </div>
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
            <svg v-else-if="item.icon === 'settings'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <svg v-else-if="item.icon === 'chat'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
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
  height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-bottom: 1px solid var(--border-color);
  min-width: 0;
}

.logo-icon {
  width: 196px;
  height: 72px;
  overflow: hidden;
  flex-shrink: 0;
}

.logo-icon img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  transform-origin: 50% 80%;
  animation: logo-wiggle 3.8s ease-in-out infinite;
  will-change: transform;
}

@keyframes logo-wiggle {
  0%,
  72%,
  100% {
    transform: rotate(0deg) translateY(0);
  }
  76% {
    transform: rotate(-3deg) translateY(-1px);
  }
  80% {
    transform: rotate(3deg) translateY(0);
  }
  84% {
    transform: rotate(-2deg) translateY(-1px);
  }
  88% {
    transform: rotate(2deg) translateY(0);
  }
  92% {
    transform: rotate(0deg) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .logo-icon img {
    animation: none;
  }
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

.sidebar.collapsed .logo-icon {
  width: 64px;
  height: 64px;
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

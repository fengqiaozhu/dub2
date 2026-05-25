<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const breadcrumbs = computed(() => {
  // Simplified breadcrumbs for the UI
  const path = route.path;
  if (path.startsWith('/books')) return ['选择书籍', '选择章节', '解析配音', '导出'];
  if (path.startsWith('/voices')) return ['音色库', '我的音色'];
  return [];
});
</script>

<template>
  <header class="header">
    <div class="breadcrumbs">
      <template v-for="(crumb, index) in breadcrumbs" :key="index">
        <div class="crumb-item" :class="{ active: index === 0 }">
          <div class="crumb-number">{{ index + 1 }}</div>
          <span class="crumb-text">{{ crumb }}</span>
        </div>
        <div class="crumb-separator" v-if="index < breadcrumbs.length - 1">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18L15 12L9 6" />
          </svg>
        </div>
      </template>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: 64px;
  background-color: var(--bg-base);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
}

.breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.crumb-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
}

.crumb-item.active {
  color: var(--accent-cyan);
}

.crumb-number {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-family: var(--font-mono);
}

.crumb-item.active .crumb-number {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
  border-color: var(--accent-cyan);
}

.crumb-separator {
  color: var(--border-focus);
  display: flex;
  align-items: center;
}
</style>

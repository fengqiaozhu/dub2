<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { accessAuthState } from '@/api/accessToken';

const unauthorized = ref(accessAuthState.unauthorized);
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    unauthorized.value = accessAuthState.unauthorized;
  }, 250);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const visible = computed(() => unauthorized.value);
</script>

<template>
  <div v-if="visible" class="access-banner" role="alert">
    <span>API 拒绝了未认证请求。请在系统设置填写与 <code>DUB_ACCESS_TOKEN</code> 相同的访问令牌。</span>
    <router-link class="banner-link" to="/settings?tab=access">去填写令牌</router-link>
  </div>
</template>

<style scoped>
.access-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(127, 29, 29, 0.35);
  border-bottom: 1px solid rgba(248, 113, 113, 0.4);
  color: #fecaca;
  font-size: 13px;
}

.access-banner code {
  font-family: var(--font-mono);
  font-size: 12px;
}

.banner-link {
  color: #67e8f9;
  font-weight: 600;
  white-space: nowrap;
}
</style>

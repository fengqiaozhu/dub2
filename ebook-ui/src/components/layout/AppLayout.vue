<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import Header from './Header.vue';
</script>

<template>
  <div class="layout-wrapper">
    <Sidebar />
    <div class="main-container">
      <Header />
      <main class="content-area">
        <slot></slot>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout-wrapper {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0; /* Important for flex children to not overflow */
}

.content-area {
  flex: 1;
  overflow: auto;
  padding: var(--space-4);
  background-color: var(--bg-base);
}
</style>

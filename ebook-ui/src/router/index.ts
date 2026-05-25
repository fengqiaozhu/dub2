import { createRouter, createWebHistory } from 'vue-router';
import BookManagement from '../views/BookManagement.vue';
import VoiceManagement from '../views/VoiceManagement.vue';

const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    {
      path: '/',
      redirect: '/books'
    },
    {
      path: '/books',
      name: 'books',
      component: BookManagement
    },
    {
      path: '/voices',
      name: 'voices',
      component: VoiceManagement
    },
    {
      path: '/workspace/:bookId?',
      name: 'workspace',
      component: () => import('../views/Workspace.vue')
    }
  ]
});

export default router;

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 13001,
    proxy: {
      '/api': {
        target: 'http://localhost:13000',
        changeOrigin: true
      },
      '/audio': {
        target: 'http://localhost:13000',
        changeOrigin: true
      },
      '/covers': {
        target: 'http://localhost:13000',
        changeOrigin: true
      }
    }
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      // 必须配置这些 headers 以支持 SharedArrayBuffer (Wasmer SDK 需要)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ['@wasmer/sdk'],
  },
  build: {
    target: 'esnext',
    // 禁用 modulePreload polyfill，避免在 Web Worker 中触发 DOM 错误
    modulePreload: {
      polyfill: false,
    },
  },
})

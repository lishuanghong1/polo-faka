import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

// Tauri 期望前端开发服务器固定端口；不要随便改
const HOST = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // tauri 在 production 走 file://，避免被 vite 注入 baseURL
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: HOST || false,
    hmr: HOST
      ? {
          protocol: 'ws',
          host: HOST,
          port: 1421,
        }
      : undefined,
    watch: {
      // src-tauri 的变更交给 cargo watch，不要让 vite 重载
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));

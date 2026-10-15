import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Local development: the backend simulator (API Gateway + Cognito emulation) on :3000.
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: true },
      '/local-auth': { target: process.env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});

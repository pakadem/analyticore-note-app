import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  build: {
    target: 'es2022',
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3002',
    },
  },
});

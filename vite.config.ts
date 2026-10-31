import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'production-content-security-policy',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return command === 'build'
            ? html.replace("script-src 'self' 'unsafe-inline';", "script-src 'self';")
            : html;
        },
      },
    },
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
}));

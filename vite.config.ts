/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Where the dev proxy sends /api. A dedicated variable (not PORT), because
  // PORT is often set for the frontend dev server itself by tooling.
  const apiPort = loadEnv(mode, process.cwd(), '').API_PORT || '3001';

  return {
    plugins: [react()],
    server: {
      // Same-origin /api in development: no CORS configuration needed.
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});

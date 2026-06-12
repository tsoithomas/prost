import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@prost/shared-types': fileURLToPath(new URL('../../packages/shared-types/src', import.meta.url)),
      '@prost/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)),
      '@prost/utils': fileURLToPath(new URL('../../packages/utils/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});

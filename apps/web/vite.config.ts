import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The monorepo root package.json carries the semantic-release version (apps/web's own
// package.json stays pinned at 0.0.0), so read it from there for the StatusBar display.
const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .env files live at the monorepo root alongside apps/api's envFilePath.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
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

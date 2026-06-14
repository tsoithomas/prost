import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@prost/shared-types': path.resolve(__dirname, '../../packages/shared-types/src'),
      '@prost/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@prost/utils': path.resolve(__dirname, '../../packages/utils/src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
});

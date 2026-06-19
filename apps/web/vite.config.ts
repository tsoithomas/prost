import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The released version of truth lives in git tags (semantic-release tags + GitHub Release only;
// it never bumps package.json). Resolve the StatusBar version from there:
//   1. APP_VERSION env  — injected by CI/Docker (the .git dir is excluded from the image build).
//   2. `git describe`   — local dev, where .git is present.
//   3. root package.json version — last-resort fallback when neither is available.
function resolveVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/, '');

  try {
    const described = execSync('git describe --tags --always', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (described) return described.replace(/^v/, '');
  } catch {
    // Not a git checkout (or git unavailable) — fall through to package.json.
  }

  const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'));
  return rootPkg.version;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .env files live at the monorepo root alongside apps/api's envFilePath.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  define: {
    __APP_VERSION__: JSON.stringify(resolveVersion()),
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

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// RTL auto-cleanup requires globals:true; since we use globals:false, call explicitly.
afterEach(() => cleanup());

// matchMedia polyfill — useIsMobile() / useMediaQuery() calls window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom's localStorage may be non-functional when started without a valid file path;
// replace it with a plain in-memory store so Zustand persist works in tests.
const _lsStore: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: (key) => _lsStore[key] ?? null,
  setItem: (key, value) => { _lsStore[key] = value; },
  removeItem: (key) => { delete _lsStore[key]; },
  clear: () => { Object.keys(_lsStore).forEach((k) => delete _lsStore[k]); },
  get length() { return Object.keys(_lsStore).length; },
  key: (index) => Object.keys(_lsStore)[index] ?? null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

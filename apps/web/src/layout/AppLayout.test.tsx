import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppLayout } from './AppLayout';
import { useThemeStore } from '../stores/themeStore';

// Mock all heavy sub-components so the test focuses on shell-selection and hydration logic.
vi.mock('./TopBar', () => ({ TopBar: () => <div data-testid="top-bar" /> }));
vi.mock('./Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./RightSidebar', () => ({ RightSidebar: () => <div data-testid="right-sidebar" /> }));
vi.mock('./StatusBar', () => ({ StatusBar: () => <div data-testid="status-bar" /> }));
vi.mock('../mobile/MobileShell', () => ({ MobileShell: () => <div data-testid="mobile-shell" /> }));
vi.mock('../connection/ConnectionModal', () => ({ ConnectionModal: () => null }));
vi.mock('../search/CommandPalette', () => ({ CommandPalette: () => null }));

// Controlled mocks for hooks that drive the logic under test.
vi.mock('../hooks/useMediaQuery', () => ({
  useIsMobile: vi.fn(() => false),
  useMediaQuery: vi.fn(() => false),
}));

vi.mock('../api/preferences', () => ({
  usePreferences: vi.fn(() => ({ data: undefined })),
}));

import { useIsMobile } from '../hooks/useMediaQuery';
import { usePreferences } from '../api/preferences';

afterEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false);
  vi.mocked(usePreferences).mockReturnValue({ data: undefined } as ReturnType<typeof usePreferences>);
  useThemeStore.setState({ colorMode: 'system' });
  document.documentElement.classList.remove('dark');
  localStorage.clear();
});

describe('AppLayout — responsive shell selection', () => {
  it('renders the desktop shell when useIsMobile returns false', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<AppLayout><div data-testid="content" /></AppLayout>);

    expect(screen.getByTestId('top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
  });

  it('renders MobileShell when useIsMobile returns true', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<AppLayout><div data-testid="content" /></AppLayout>);

    expect(screen.getByTestId('mobile-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('top-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-bar')).not.toBeInTheDocument();
  });

  it('desktop shell renders children in the main area', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<AppLayout><div data-testid="content">hello</div></AppLayout>);
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});

describe('AppLayout — server preference hydration', () => {
  beforeEach(() => {
    // Start with a known local state so we can confirm the server value wins.
    useThemeStore.setState({ colorMode: 'system' });
  });

  it('applies server colorMode when it differs from the local store', async () => {
    vi.mocked(usePreferences).mockReturnValue({
      data: { colorMode: 'dark', accentColor: '#6366f1' },
    } as ReturnType<typeof usePreferences>);

    render(<AppLayout><div /></AppLayout>);

    await waitFor(() => {
      expect(useThemeStore.getState().colorMode).toBe('dark');
    });
  });

  it('does not overwrite colorMode when server and local already agree', async () => {
    useThemeStore.setState({ colorMode: 'light' });
    vi.mocked(usePreferences).mockReturnValue({
      data: { colorMode: 'light', accentColor: '#6366f1' },
    } as ReturnType<typeof usePreferences>);

    render(<AppLayout><div /></AppLayout>);

    // Give effects time to run; colorMode must remain 'light'.
    await waitFor(() => {
      expect(useThemeStore.getState().colorMode).toBe('light');
    });
  });
});

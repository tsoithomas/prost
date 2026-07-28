import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { MobileShell } from './MobileShell';
import { renderWithProviders } from '../test/renderWithProviders';
import { useAiStore } from '../stores/aiStore';

// Stub the heavy tab bodies; the test only cares which one is mounted.
vi.mock('../workspace/Workspace', () => ({ Workspace: () => <div data-testid="workspace" /> }));
vi.mock('../ai/ChatPanel', () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));
vi.mock('./MobileExplorerView', () => ({ MobileExplorerView: () => <div data-testid="explorer" /> }));
vi.mock('./MobileSettingsView', () => ({ MobileSettingsView: () => <div data-testid="settings" /> }));
vi.mock('./MobileTopBar', () => ({ MobileTopBar: () => <div data-testid="top-bar" /> }));
vi.mock('./MobileBottomNav', () => ({ MobileBottomNav: () => <div data-testid="bottom-nav" /> }));

vi.mock('../stores/connectionStore', () => ({
  useConnectionStore: (selector: (s: { activeConnectionId: string }) => unknown) =>
    selector({ activeConnectionId: 'conn-1' }),
}));

afterEach(() => {
  useAiStore.setState({ pendingChatPrompt: null, rightSidebarOpen: false });
});

describe('MobileShell', () => {
  it('starts on the explorer tab', () => {
    renderWithProviders(<MobileShell onOpenConnections={vi.fn()} />);
    expect(screen.getByTestId('explorer')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('switches to the AI tab when a chat prompt is queued (e.g. "Fix with AI")', async () => {
    renderWithProviders(<MobileShell onOpenConnections={vi.fn()} />);
    act(() => {
      useAiStore.getState().sendToChat('Explain this error');
    });
    await waitFor(() => expect(screen.getByTestId('chat-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('explorer')).not.toBeInTheDocument();
  });
});

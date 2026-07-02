import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useAuthStore } from '../stores/authStore';

// ThemeSettings pulls in react-query hooks; stub it so this test stays focused on sign-out.
vi.mock('./ThemeSettings', () => ({ ThemeSettings: () => <div data-testid="theme-settings" /> }));

afterEach(() => {
  useAuthStore.setState({ token: null, user: null });
  localStorage.clear();
});

describe('SettingsPanel — sign out', () => {
  it('shows the signed-in email and clears auth + closes on Sign Out', () => {
    useAuthStore.setState({ token: 'jwt', user: { id: '1', email: 'me@example.com', createdAt: '' } });
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);

    expect(screen.getByText('me@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SettingsPanel — outside-click', () => {
  it('closes on a pointerdown outside the panel', () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on a pointerdown inside the trigger (prevents close-then-reopen)', () => {
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    // @ts-expect-error assigning to a ref object's current in a test
    triggerRef.current = trigger;

    render(<SettingsPanel onClose={onClose} triggerRef={triggerRef} />);

    fireEvent.pointerDown(trigger);

    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(trigger);
  });
});

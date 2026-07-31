import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useThemeStore } from '../../stores/themeStore';
import { PrivacySection } from './PrivacySection';

vi.mock('../../api/connections', () => ({
  useConnections: () => ({ data: [{ id: 'conn-1', name: 'demo-pg' }] }),
}));

const MASKED = { 'conn-1': { 'public.users': ['email', 'phone'] } };

beforeEach(() => {
  useThemeStore.setState({ maskedColumns: structuredClone(MASKED) });
});

describe('PrivacySection', () => {
  it('lists masked columns under their connection and table', () => {
    renderWithProviders(<PrivacySection save={vi.fn()} query="" />);

    expect(screen.getByText('demo-pg')).toBeInTheDocument();
    expect(screen.getByText('public.users')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('phone')).toBeInTheDocument();
  });

  it('states the scope — masking is not access control', () => {
    const { container } = renderWithProviders(<PrivacySection save={vi.fn()} query="" />);

    expect(container.textContent).toContain('Query results are never masked');
    expect(container.textContent).toMatch(/does not restrict access/);
  });

  it('unmasks one column and persists the rest', async () => {
    const save = vi.fn();
    renderWithProviders(<PrivacySection save={save} query="" />);

    await userEvent.click(screen.getByLabelText('Unmask public.users.email'));

    expect(save).toHaveBeenCalledWith({ maskedColumns: { 'conn-1': { 'public.users': ['phone'] } } });
    expect(useThemeStore.getState().maskedColumns).toEqual({ 'conn-1': { 'public.users': ['phone'] } });
  });

  it('drops the table (and connection) once its last column is unmasked', async () => {
    useThemeStore.setState({ maskedColumns: { 'conn-1': { 'public.users': ['email'] } } });
    const save = vi.fn();
    renderWithProviders(<PrivacySection save={save} query="" />);

    await userEvent.click(screen.getByLabelText('Unmask public.users.email'));

    expect(save).toHaveBeenCalledWith({ maskedColumns: {} });
  });

  it('shows an empty state pointing at the grid header menu', () => {
    useThemeStore.setState({ maskedColumns: {} });
    renderWithProviders(<PrivacySection save={vi.fn()} query="" />);

    expect(screen.getByText(/Nothing is masked/)).toBeInTheDocument();
  });

  it('falls back to the connection id when the connection is gone', () => {
    useThemeStore.setState({ maskedColumns: { 'conn-gone': { 'public.t': ['c'] } } });
    renderWithProviders(<PrivacySection save={vi.fn()} query="" />);

    expect(screen.getByText('conn-gone')).toBeInTheDocument();
  });
});

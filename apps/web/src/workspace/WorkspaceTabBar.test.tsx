import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceTabBar, type WorkspaceTab } from './WorkspaceTabBar';

const tabs: WorkspaceTab[] = [
  { id: 'a', label: 'Alpha', kind: 'query' },
  { id: 'b', label: 'Beta', kind: 'table' },
  { id: 'c', label: 'Gamma', kind: 'table' },
];

function renderBar(activeTabId = 'a', onSelect = vi.fn()) {
  render(
    <WorkspaceTabBar
      tabs={tabs}
      activeTabId={activeTabId}
      onSelect={onSelect}
      onClose={vi.fn()}
      onNewTab={vi.fn()}
      onReorder={vi.fn()}
      onCloseOthers={vi.fn()}
      onCloseToLeft={vi.fn()}
      onCloseToRight={vi.fn()}
      onCloseAllTables={vi.fn()}
    />,
  );
  return onSelect;
}

describe('WorkspaceTabBar accessibility', () => {
  it('exposes a tablist with role=tab and aria-selected on the active tab', () => {
    renderBar('b');
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument();
    const tablist = screen.getAllByRole('tab');
    expect(tablist).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('roving tabindex: only the active tab is tabbable', () => {
    renderBar('a');
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight/ArrowLeft move selection', () => {
    const onSelect = renderBar('a');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
    onSelect.mockClear();
    // From the first tab, ArrowLeft stays put (clamped).
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

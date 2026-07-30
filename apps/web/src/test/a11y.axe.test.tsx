import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { Modal } from '@prost/ui';
import { ShortcutsHelp } from '../layout/ShortcutsHelp';
import { WorkspaceTabBar, type WorkspaceTab } from '../workspace/WorkspaceTabBar';
import { useShortcutsStore } from '../stores/shortcutsStore';

beforeAll(() => {
  expect.extend(axeMatchers);
});

afterEach(() => {
  useShortcutsStore.setState({ open: false });
});

const tabs: WorkspaceTab[] = [
  { id: 'a', label: 'Alpha', kind: 'query' },
  { id: 'b', label: 'Beta', kind: 'table' },
];

describe('axe: no accessibility violations', () => {
  it('Modal with a labeled form', async () => {
    const { container } = render(
      <Modal open onClose={() => {}} title="Example dialog">
        <label>
          Name
          <input />
        </label>
        <button type="button">Save</button>
      </Modal>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ShortcutsHelp overlay', async () => {
    useShortcutsStore.setState({ open: true });
    const { baseElement } = render(<ShortcutsHelp />);
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('WorkspaceTabBar', async () => {
    const { container } = render(
      <WorkspaceTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
        onReorder={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseToLeft={vi.fn()}
        onCloseToRight={vi.fn()}
        onCloseAllTables={vi.fn()}
      />,
    );
    // The tabpanel that tabs reference lives in the Workspace shell, not here; scope axe to the bar.
    expect(await axe(container, { rules: { 'aria-valid-attr-value': { enabled: false } } })).toHaveNoViolations();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});

import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { IconButton, Modal, Tooltip } from '@prost/ui';
import { FocusModeExit } from '../layout/FocusModeExit';
import { ShortcutsHelp } from '../layout/ShortcutsHelp';
import { ErDiagramView } from '../workspace/ErDiagramView';
import { WorkspaceTabBar, type WorkspaceTab } from '../workspace/WorkspaceTabBar';
import { useShortcutsStore } from '../stores/shortcutsStore';

vi.mock('../api/metadata', () => ({
  useMetadata: () => ({
    data: [
      {
        name: 'public',
        objects: [],
        tables: [
          {
            schema: 'public',
            name: 'users',
            columns: [{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null }],
          },
          {
            schema: 'public',
            name: 'orders',
            columns: [{ name: 'user_id', dataType: 'integer', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null }],
          },
        ],
      },
    ],
    isLoading: false,
    isError: false,
  }),
  useSchemaForeignKeys: () => ({
    data: [
      {
        constraintName: 'orders_user_id_fkey',
        table: 'orders',
        schema: 'public',
        columns: ['user_id'],
        referencedSchema: 'public',
        referencedTable: 'users',
        referencedColumns: ['id'],
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

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

  it('ErDiagramView', async () => {
    const { container } = render(<ErDiagramView connectionId="c1" schema="public" />);
    expect(await axe(container)).toHaveNoViolations();
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

  it('Tooltip, open (Phase 40)', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tooltip content="Refresh data" shortcut="Alt+R">
        <IconButton aria-label="Refresh">R</IconButton>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Refresh' }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FocusModeExit — the focus-mode shell\'s only chrome (Phase 40)', async () => {
    const { container } = render(<FocusModeExit onExit={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

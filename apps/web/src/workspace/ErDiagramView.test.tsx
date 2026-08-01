import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchemaForeignKey, SchemaMetadata } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ErDiagramView } from './ErDiagramView';

const { mockMetadata, mockForeignKeys } = vi.hoisted(() => ({
  mockMetadata: vi.fn(),
  mockForeignKeys: vi.fn(),
}));

vi.mock('../api/metadata', () => ({
  useMetadata: () => mockMetadata(),
  useSchemaForeignKeys: () => mockForeignKeys(),
}));

function column(name: string, isPrimaryKey = false) {
  return { name, dataType: 'integer', nullable: !isPrimaryKey, isPrimaryKey, autoIncrement: false, defaultValue: null };
}

const SCHEMAS: SchemaMetadata[] = [
  {
    name: 'public',
    objects: [],
    tables: [
      { schema: 'public', name: 'users', columns: [column('id', true)] },
      { schema: 'public', name: 'orders', columns: [column('id', true), column('user_id')] },
    ],
  },
];

const FKS: SchemaForeignKey[] = [
  {
    constraintName: 'orders_user_id_fkey',
    table: 'orders',
    schema: 'public',
    columns: ['user_id'],
    referencedSchema: 'public',
    referencedTable: 'users',
    referencedColumns: ['id'],
    onDelete: 'CASCADE',
  },
];

function loaded<T>(data: T) {
  return { data, isLoading: false, isError: false };
}

function renderDiagram() {
  return renderWithProviders(<ErDiagramView connectionId="c1" schema="public" />);
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], activeTabId: '' });
  mockMetadata.mockReturnValue(loaded(SCHEMAS));
  mockForeignKeys.mockReturnValue(loaded(FKS));
});

describe('ErDiagramView', () => {
  it('renders one node per table and one edge per foreign key', () => {
    const { container } = renderDiagram();

    expect(screen.getByRole('button', { name: 'Open table users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open table orders' })).toBeInTheDocument();
    expect(container.querySelectorAll('path[data-edge]')).toHaveLength(1);
    expect(container.textContent).toContain('2 tables · 1 relationship');
  });

  it('opens the table as a workspace tab when a node is clicked', async () => {
    renderDiagram();

    await userEvent.click(screen.getByRole('button', { name: 'Open table orders' }));

    const state = useWorkspaceStore.getState();
    expect(state.activeTabId).toBe('table:c1:public.orders');
    expect(state.tabs[0]).toMatchObject({ kind: 'table', schema: 'public', table: 'orders' });
  });

  it('shows the constraint detail and both endpoints when an edge is clicked', async () => {
    const { container } = renderDiagram();

    const edge = container.querySelector('path[data-edge]')!;
    await userEvent.click(edge);

    // The constraint name appears both in the relationship list and in the detail block.
    expect(screen.getAllByText('orders_user_id_fkey').length).toBeGreaterThan(0);
    expect(screen.getByText('orders.user_id → users.id')).toBeInTheDocument();
    expect(screen.getByText(/on delete CASCADE/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open users' }));
    expect(useWorkspaceStore.getState().activeTabId).toBe('table:c1:public.users');
  });

  it('lists relationships as keyboard-reachable buttons', async () => {
    renderDiagram();

    await userEvent.click(screen.getByRole('button', { name: /Relationships/ }));
    await userEvent.click(screen.getByRole('button', { name: /orders → users/ }));

    expect(screen.getByText('orders.user_id → users.id')).toBeInTheDocument();
  });

  it('toggles between key columns and all columns', async () => {
    // `total` is neither a PK nor an FK, so it is hidden until "All columns" is on.
    mockMetadata.mockReturnValue(
      loaded([
        {
          ...SCHEMAS[0]!,
          tables: [
            { schema: 'public', name: 'users', columns: [column('id', true)] },
            { schema: 'public', name: 'orders', columns: [column('id', true), column('user_id'), column('total')] },
          ],
        },
      ]),
    );
    const { container } = renderDiagram();
    expect(container.textContent).not.toContain('total');

    await userEvent.click(screen.getByRole('button', { name: 'All columns' }));
    expect(container.textContent).toContain('total');
  });

  it('renders the nodes and a note when the schema has no relationships', async () => {
    mockForeignKeys.mockReturnValue(loaded([]));
    const { container } = renderDiagram();

    expect(screen.getByRole('button', { name: 'Open table users' })).toBeInTheDocument();
    expect(container.querySelectorAll('path[data-edge]')).toHaveLength(0);
    expect(container.textContent).toContain('0 relationships');

    await userEvent.click(screen.getByRole('button', { name: /Relationships/ }));
    expect(screen.getByText('No foreign-key relationships in this schema.')).toBeInTheDocument();
  });

  it('reports foreign keys that point outside the schema instead of drawing them', () => {
    mockForeignKeys.mockReturnValue(
      loaded([
        ...FKS,
        {
          constraintName: 'orders_region_fkey',
          table: 'orders',
          schema: 'public',
          columns: ['region_id'],
          referencedSchema: 'reference',
          referencedTable: 'regions',
          referencedColumns: ['id'],
        },
      ]),
    );
    const { container } = renderDiagram();

    expect(container.querySelectorAll('path[data-edge]')).toHaveLength(1);
    expect(container.textContent).toContain('1 outside this schema');
  });

  it('shows an empty state for a schema with no tables', () => {
    mockMetadata.mockReturnValue(loaded([{ name: 'empty', tables: [], objects: [] }]));
    mockForeignKeys.mockReturnValue(loaded([]));
    renderWithProviders(<ErDiagramView connectionId="c1" schema="empty" />);

    expect(screen.getByText('No tables in this schema.')).toBeInTheDocument();
  });

  it('zooms at the pointer on a plain wheel — deliberate, not gated behind Ctrl (Phase 40)', () => {
    const { container } = renderDiagram();
    // The transformed canvas (has `scale()`) is the div right below the wheel listener's target
    // (`.origin-top-left`, not `<svg>` — the diagram's icons are also `svg`s, so `container.querySelector('svg')`
    // would grab a header icon instead).
    const canvas = container.querySelector('.origin-top-left') as HTMLElement;
    const viewport = canvas.parentElement!;

    const scaleOf = (transform: string) => Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? '1');
    const before = scaleOf(canvas.style.transform);

    // clientX/clientY must be set — jsdom's zero-size layout means an unset pointer position
    // resolves to NaN, which poisons the whole `transform` string and jsdom silently keeps the
    // last valid value (masking the scale change this test is actually checking).
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 50, clientY: 50 });

    expect(scaleOf(canvas.style.transform)).toBeGreaterThan(before);
  });

  it('opens at 100% scale regardless of viewport size — labels stay legible, never auto-shrunk', () => {
    // A viewport far smaller than the diagram's natural bounds would, if this auto-fit a "shrink to
    // show everything" scale, render table labels illegibly small on first open. It doesn't: opening
    // always starts at 100%, panned into a top-left-anchored view instead of zoomed out.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 100, height: 80, top: 0, left: 0, right: 100, bottom: 80, x: 0, y: 0, toJSON: () => {} } as DOMRect);

    const { container } = renderDiagram();
    const canvas = container.querySelector('.origin-top-left') as HTMLElement;
    const scaleOf = (transform: string) => Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? '1');

    expect(scaleOf(canvas.style.transform)).toBeCloseTo(1);

    rectSpy.mockRestore();
  });

  it('"Fit to view" still shrinks to show the whole diagram on demand', async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 100, height: 80, top: 0, left: 0, right: 100, bottom: 80, x: 0, y: 0, toJSON: () => {} } as DOMRect);

    const { container } = renderDiagram();
    const canvas = container.querySelector('.origin-top-left') as HTMLElement;
    const scaleOf = (transform: string) => Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? '1');
    expect(scaleOf(canvas.style.transform)).toBeCloseTo(1);

    await userEvent.click(screen.getByRole('button', { name: 'Fit to view' }));
    expect(scaleOf(canvas.style.transform)).toBeLessThan(1);

    rectSpy.mockRestore();
  });

  it('re-attaches the wheel listener once the FK query finishes loading (regression)', () => {
    // Reproduces a real bug: table nodes come from metadata alone, so node count can be identical
    // before and after the FK query resolves. An effect keyed on node count would see an unchanged
    // dependency across that transition and never re-run to pick up the now-mounted viewport div —
    // the listener would attach to nothing and wheel zoom would silently do nothing on first load
    // (only working after switching tabs away and back, which remounts fresh with warm caches).
    mockForeignKeys.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container, rerender } = renderDiagram();
    expect(container.textContent).toContain('Loading diagram…');

    mockForeignKeys.mockReturnValue(loaded(FKS));
    rerender(<ErDiagramView connectionId="c1" schema="public" />);

    const canvas = container.querySelector('.origin-top-left') as HTMLElement;
    const viewport = canvas.parentElement!;
    const scaleOf = (transform: string) => Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? '1');
    const before = scaleOf(canvas.style.transform);

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 50, clientY: 50 });

    expect(scaleOf(canvas.style.transform)).toBeGreaterThan(before);
  });

  it('surfaces loading and error states', () => {
    mockForeignKeys.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const loading = renderDiagram();
    expect(loading.container.textContent).toContain('Loading diagram…');

    mockForeignKeys.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const failed = renderDiagram();
    expect(failed.container.textContent).toContain('Failed to load schema relationships.');
  });
});

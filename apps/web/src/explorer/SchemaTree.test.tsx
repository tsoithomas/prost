import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchemaMetadata } from '@prost/shared-types';
import { SchemaTree } from './SchemaTree';

const schemas: SchemaMetadata[] = [
  {
    name: 'public',
    tables: [
      { schema: 'public', name: 'users', columns: [] },
      { schema: 'public', name: 'orders', columns: [] },
      { schema: 'public', name: 'products', columns: [] },
    ],
    objects: [
      { kind: 'view', schema: 'public', name: 'active_users' },
      { kind: 'function', schema: 'public', name: 'total_sales' },
    ],
  },
  {
    name: 'analytics',
    tables: [{ schema: 'analytics', name: 'events', columns: [] }],
    objects: [],
  },
];

function renderTree(props: Partial<React.ComponentProps<typeof SchemaTree>> = {}) {
  return render(
    <SchemaTree
      schemas={schemas}
      selectedTable={null}
      onSelectTable={vi.fn()}
      onOpenStructure={vi.fn()}
      onSelectObject={vi.fn()}
      onNewTable={vi.fn()}
      onOpenOverview={vi.fn()}
      {...props}
    />,
  );
}

describe('SchemaTree filter', () => {
  it('renders all tables when the filter is empty', () => {
    renderTree();
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.getByText('products')).toBeInTheDocument();
    expect(screen.getByText('events')).toBeInTheDocument();
  });

  it('narrows the list to matching tables and hides non-matching schema groups', async () => {
    renderTree();
    await userEvent.type(screen.getByLabelText('Filter tables'), 'ord');
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.queryByText('users')).not.toBeInTheDocument();
    expect(screen.queryByText('products')).not.toBeInTheDocument();
    // The analytics schema group (no match) is hidden entirely.
    expect(screen.queryByText('events')).not.toBeInTheDocument();
    expect(screen.queryByText('analytics')).not.toBeInTheDocument();
  });

  it('matches case-insensitively', async () => {
    renderTree();
    await userEvent.type(screen.getByLabelText('Filter tables'), 'USER');
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.queryByText('orders')).not.toBeInTheDocument();
  });

  it('clearing the filter restores the full list', async () => {
    renderTree();
    const input = screen.getByLabelText('Filter tables');
    await userEvent.type(input, 'ord');
    expect(screen.queryByText('users')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Clear filter'));
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText('events')).toBeInTheDocument();
  });

  it('shows a "no tables match" message when nothing matches', async () => {
    renderTree();
    await userEvent.type(screen.getByLabelText('Filter tables'), 'zzz');
    expect(screen.getByText(/no tables match/i)).toBeInTheDocument();
  });

  it('filters the flat list when the engine has no schemas', async () => {
    renderTree({ hasSchemas: false });
    await userEvent.type(screen.getByLabelText('Filter tables'), 'event');
    expect(screen.getByText('events')).toBeInTheDocument();
    expect(screen.queryByText('users')).not.toBeInTheDocument();
  });
});

describe('SchemaTree object groups', () => {
  it('renders per-kind groups only for kinds present, hiding empty ones', () => {
    renderTree();
    expect(screen.getByText('Views (1)')).toBeInTheDocument();
    expect(screen.getByText('Functions (1)')).toBeInTheDocument();
    expect(screen.getByText('active_users')).toBeInTheDocument();
    expect(screen.getByText('total_sales')).toBeInTheDocument();
    // Kinds with no objects never render a group header.
    expect(screen.queryByText(/^Triggers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Sequences/)).not.toBeInTheDocument();
  });

  it('calls onSelectObject with the clicked object', async () => {
    const onSelectObject = vi.fn();
    renderTree({ onSelectObject });
    await userEvent.click(screen.getByText('active_users'));
    expect(onSelectObject).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'view', name: 'active_users', schema: 'public' }),
    );
  });

  it('filters objects by name alongside tables', async () => {
    renderTree();
    await userEvent.type(screen.getByLabelText('Filter tables'), 'active');
    expect(screen.getByText('active_users')).toBeInTheDocument();
    // A non-matching object is hidden, and its group header disappears.
    expect(screen.queryByText('total_sales')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Functions/)).not.toBeInTheDocument();
  });
});

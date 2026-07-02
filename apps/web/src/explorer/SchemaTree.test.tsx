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
  },
  {
    name: 'analytics',
    tables: [{ schema: 'analytics', name: 'events', columns: [] }],
  },
];

function renderTree(props: Partial<React.ComponentProps<typeof SchemaTree>> = {}) {
  return render(
    <SchemaTree
      schemas={schemas}
      selectedTable={null}
      onSelectTable={vi.fn()}
      onOpenStructure={vi.fn()}
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

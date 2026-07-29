import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchemaSuggestion } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { useDdlStore } from '../stores/ddlStore';
import { SchemaSuggestionList } from './SchemaSuggestionList';

const INDEX_SUGGESTION: SchemaSuggestion = {
  change: {
    kind: 'createIndex',
    request: { schema: 'public', table: 'orders', columns: ['user_id'], unique: false },
  },
  rationale: 'The plan sequentially scans orders filtering on user_id, which has no index.',
  sql: 'CREATE INDEX "orders_user_id_idx" ON "public"."orders" USING btree ("user_id")',
};

describe('SchemaSuggestionList', () => {
  beforeEach(() => {
    useDdlStore.setState({ pending: null });
  });

  it('renders the rationale and the server-generated SQL', () => {
    renderWithProviders(<SchemaSuggestionList connectionId="conn-1" suggestions={[INDEX_SUGGESTION]} />);

    expect(screen.getByText(/sequentially scans orders/)).toBeTruthy();
    expect(screen.getByText(/CREATE INDEX "orders_user_id_idx"/)).toBeTruthy();
    expect(screen.getByText('Index on public.orders (user_id)')).toBeTruthy();
  });

  it('hands the change to ddlStore on "Review change" — and executes nothing itself', async () => {
    renderWithProviders(<SchemaSuggestionList connectionId="conn-1" suggestions={[INDEX_SUGGESTION]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Review change' }));

    expect(useDdlStore.getState().pending).toEqual({
      connectionId: 'conn-1',
      schema: 'public',
      table: 'orders',
      change: INDEX_SUGGESTION.change,
    });
  });

  it('labels an alter-table suggestion by its operation and column', () => {
    renderWithProviders(
      <SchemaSuggestionList
        connectionId="conn-1"
        suggestions={[
          {
            ...INDEX_SUGGESTION,
            change: {
              kind: 'alterTable',
              request: {
                schema: 'public',
                table: 'orders',
                operation: { kind: 'setNotNull', column: 'user_id', notNull: true },
              },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText('Change nullability of public.orders.user_id')).toBeTruthy();
  });

  it('shows an empty state rather than a bare panel when nothing was suggested', () => {
    renderWithProviders(<SchemaSuggestionList connectionId="conn-1" suggestions={[]} />);
    expect(screen.getByText('No schema changes suggested.')).toBeTruthy();
  });

  it('shows a loading state and, separately, a server error', () => {
    const { unmount } = renderWithProviders(
      <SchemaSuggestionList connectionId="conn-1" suggestions={[]} loading />,
    );
    expect(screen.getByText('Looking for schema improvements…')).toBeTruthy();
    unmount();

    renderWithProviders(
      <SchemaSuggestionList connectionId="conn-1" suggestions={[]} error="This connection is read-only" />,
    );
    expect(screen.getByRole('alert').textContent).toBe('This connection is read-only');
  });
});

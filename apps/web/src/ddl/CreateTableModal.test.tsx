import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateTableModal } from './CreateTableModal';
import { renderWithProviders } from '../test/renderWithProviders';

const mockMutate = vi.fn();

vi.mock('../api/ddl', () => ({
  useCreateTable: () => ({ mutate: mockMutate, isPending: false, reset: vi.fn() }),
}));

const DEFAULT_PROPS = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  connectionId: 'conn-1',
  initialSchema: 'public',
  schemas: ['public', 'custom'],
};

function renderModal() {
  return renderWithProviders(<CreateTableModal {...DEFAULT_PROPS} />);
}

describe('CreateTableModal — SQL preview', () => {
  it('shows no preview until a table name and column name are both provided', async () => {
    renderModal();
    expect(screen.queryByText(/CREATE TABLE/)).not.toBeInTheDocument();

    // Enter table name only — no preview yet (no named column)
    const tableInput = screen.getByPlaceholderText('my_table');
    await userEvent.type(tableInput, 'orders');
    expect(screen.queryByText(/CREATE TABLE/)).not.toBeInTheDocument();
  });

  it('renders the SQL preview once table name and column name are both entered', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'orders');
    const [firstColumnNameInput] = screen.getAllByPlaceholderText('column_name');
    await userEvent.type(firstColumnNameInput!, 'id');

    // pre element containing the SQL should now be visible
    const pre = screen.getByText(/CREATE TABLE/);
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toContain('"orders"');
    expect(pre.textContent).toContain('"id"');
  });

  it('adds NOT NULL to the preview when the Nullable checkbox is unchecked', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'products');
    await userEvent.type(screen.getAllByPlaceholderText('column_name')[0]!, 'sku');

    // Uncheck "Nullable" for the first column
    const nullableCheckbox = screen.getAllByRole('checkbox', { name: /nullable/i })[0]!;
    await userEvent.click(nullableCheckbox);

    expect(screen.getByText(/CREATE TABLE/).textContent).toContain('NOT NULL');
  });
});

describe('CreateTableModal — validation gate', () => {
  it('blocks submission and shows an error when table name is empty', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/table name is required/i);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('blocks submission when no column has a name', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'events');
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/at least one column/i);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('calls the mutation with the correct payload on a valid form', async () => {
    renderModal();

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'items');
    await userEvent.type(screen.getAllByPlaceholderText('column_name')[0]!, 'title');
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
    const [payload] = mockMutate.mock.calls[0]!;
    expect(payload).toMatchObject({ schema: 'public', table: 'items' });
    expect(payload.columns[0]).toMatchObject({ name: 'title' });
  });
});

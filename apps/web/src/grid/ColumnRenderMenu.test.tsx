import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnRenderMenu } from './ColumnRenderMenu';
import type { HeaderContextMenuArgs } from './columnDefs';

const stringHeader: HeaderContextMenuArgs = { field: 'email', category: 'string', x: 10, y: 20 };

describe('ColumnRenderMenu — search this column', () => {
  it('submits a typed term via onFilterColumn and closes', async () => {
    const onFilterColumn = vi.fn();
    const onClose = vi.fn();
    render(
      <ColumnRenderMenu
        state={stringHeader}
        onSelect={vi.fn()}
        onFilterColumn={onFilterColumn}
        onClose={onClose}
      />,
    );

    const input = screen.getByLabelText('Search column email');
    await userEvent.type(input, 'ada{Enter}');

    expect(onFilterColumn).toHaveBeenCalledWith('ada');
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores an empty/whitespace term', async () => {
    const onFilterColumn = vi.fn();
    render(
      <ColumnRenderMenu state={stringHeader} onSelect={vi.fn()} onFilterColumn={onFilterColumn} onClose={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText('Search column email'), '   {Enter}');
    expect(onFilterColumn).not.toHaveBeenCalled();
  });

  it('still offers render-mode options alongside the search box', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ColumnRenderMenu state={stringHeader} onSelect={onSelect} onFilterColumn={vi.fn()} onClose={onClose} />,
    );

    // A string column offers "Render as JSON".
    await userEvent.click(screen.getByRole('button', { name: 'Render as JSON' }));
    expect(onSelect).toHaveBeenCalledWith('json');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when there is no active header', () => {
    const { container } = render(<ColumnRenderMenu state={null} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ColumnRenderMenu — clear sort', () => {
  it('offers "Clear sort" only when the column is sorted, and clears + closes on click', async () => {
    const onClearSort = vi.fn();
    const onClose = vi.fn();
    render(
      <ColumnRenderMenu
        state={{ ...stringHeader, onClearSort }}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clear sort' }));
    expect(onClearSort).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('hides "Clear sort" when the column is not sorted', () => {
    render(<ColumnRenderMenu state={stringHeader} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear sort' })).toBeNull();
  });
});

describe('ColumnRenderMenu — mark sensitive (Phase 39)', () => {
  it('offers the toggle only when the host can persist it', () => {
    const { rerender } = render(<ColumnRenderMenu state={stringHeader} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText('Mark sensitive')).not.toBeInTheDocument();

    rerender(
      <ColumnRenderMenu state={stringHeader} onSelect={vi.fn()} onToggleMask={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Mark sensitive')).toBeInTheDocument();
  });

  it('marks an unmasked column and closes', async () => {
    const onToggleMask = vi.fn();
    const onClose = vi.fn();
    render(
      <ColumnRenderMenu state={stringHeader} onSelect={vi.fn()} onToggleMask={onToggleMask} onClose={onClose} />,
    );

    await userEvent.click(screen.getByText('Mark sensitive'));

    expect(onToggleMask).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers to unmark an already-masked column', async () => {
    const onToggleMask = vi.fn();
    render(
      <ColumnRenderMenu state={stringHeader} masked onSelect={vi.fn()} onToggleMask={onToggleMask} onClose={vi.fn()} />,
    );

    await userEvent.click(screen.getByText('Unmark sensitive'));

    expect(onToggleMask).toHaveBeenCalledWith(false);
  });
});

describe('ColumnRenderMenu — primary keys cannot be masked (Phase 39)', () => {
  const pkHeader: HeaderContextMenuArgs = { field: 'id', category: 'integer', isPrimaryKey: true, x: 10, y: 20 };

  it('explains why instead of offering the toggle', () => {
    render(<ColumnRenderMenu state={pkHeader} onSelect={vi.fn()} onToggleMask={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("A primary key can't be masked")).toBeInTheDocument();
    expect(screen.queryByText('Mark sensitive')).not.toBeInTheDocument();
  });

  it('still offers the toggle on a non-key column', () => {
    render(<ColumnRenderMenu state={stringHeader} onSelect={vi.fn()} onToggleMask={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Mark sensitive')).toBeInTheDocument();
    expect(screen.queryByText("A primary key can't be masked")).not.toBeInTheDocument();
  });
});

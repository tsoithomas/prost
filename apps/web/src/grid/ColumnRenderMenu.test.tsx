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

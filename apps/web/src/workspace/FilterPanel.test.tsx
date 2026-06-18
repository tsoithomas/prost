import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnMetadata } from '@prost/shared-types';
import { FilterPanel, operatorsForColumn } from './FilterPanel';
import { renderWithProviders } from '../test/renderWithProviders';

function col(name: string, dataType: string): ColumnMetadata {
  return { name, dataType, nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null };
}

const COLUMNS: ColumnMetadata[] = [
  col('email', 'character varying'),
  col('age', 'integer'),
  col('active', 'boolean'),
];

describe('FilterPanel', () => {
  it('renders all column names in the column dropdown when a condition exists', () => {
    renderWithProviders(
      <FilterPanel
        columns={COLUMNS}
        activeFilter={{ conditions: [{ column: 'email', operator: 'eq', value: '' }], combinator: 'and' }}
        onChange={vi.fn()}
      />,
    );
    const columnSelect = screen.getByRole('combobox', { name: /filter column/i });
    expect(columnSelect).toBeInTheDocument();
    for (const c of COLUMNS) {
      expect(screen.getByRole('option', { name: c.name })).toBeInTheDocument();
    }
  });

  it('adding a condition calls onChange with a RowFilter', async () => {
    const onChange = vi.fn();
    renderWithProviders(<FilterPanel columns={COLUMNS} activeFilter={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([expect.objectContaining({ column: 'email' })]),
        combinator: 'and',
      }),
    );
  });

  it('isNull operator hides the value input', async () => {
    renderWithProviders(
      <FilterPanel
        columns={COLUMNS}
        activeFilter={{ conditions: [{ column: 'email', operator: 'isNull' }], combinator: 'and' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox', { name: /filter value/i })).not.toBeInTheDocument();
  });

  it('removing a condition calls onChange with it removed', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FilterPanel
        columns={COLUMNS}
        activeFilter={{
          conditions: [{ column: 'email', operator: 'eq', value: 'test' }],
          combinator: 'and',
        }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove condition 1/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('Clear all calls onChange(null)', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FilterPanel
        columns={COLUMNS}
        activeFilter={{
          conditions: [{ column: 'age', operator: 'gt', value: 18 }],
          combinator: 'and',
        }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('integer column does not include contains in operator options', () => {
    const intCol = col('age', 'integer');
    const ops = operatorsForColumn(intCol);
    expect(ops).not.toContain('contains');
    expect(ops).not.toContain('startsWith');
    expect(ops).not.toContain('endsWith');
  });

  it('text column includes all operators', () => {
    const textCol = col('email', 'character varying');
    const ops = operatorsForColumn(textCol);
    expect(ops).toContain('contains');
    expect(ops).toContain('startsWith');
    expect(ops).toContain('in');
  });
});

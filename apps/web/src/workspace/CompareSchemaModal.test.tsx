import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionDto, SchemaMetadata } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { CompareSchemaModal } from './CompareSchemaModal';

const CONNECTIONS: Pick<ConnectionDto, 'id' | 'name'>[] = [
  { id: 'left-conn', name: 'Staging' },
  { id: 'right-conn', name: 'Prod' },
];

const METADATA_BY_CONNECTION: Record<string, SchemaMetadata[]> = {
  'right-conn': [
    { name: 'public', tables: [], objects: [] },
    { name: 'reporting', tables: [], objects: [] },
  ],
};

vi.mock('../api/connections', () => ({ useConnections: () => ({ data: CONNECTIONS }) }));
vi.mock('../api/metadata', () => ({
  useMetadata: (connectionId: string | null) => ({ data: connectionId ? (METADATA_BY_CONNECTION[connectionId] ?? []) : undefined }),
}));

function open(onCompare = vi.fn()) {
  renderWithProviders(
    <CompareSchemaModal open onClose={vi.fn()} connectionId="left-conn" schema="public" onCompare={onCompare} />,
  );
  return onCompare;
}

describe('CompareSchemaModal', () => {
  it('disables Compare until a connection and schema are picked', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Connection to compare against'), 'Prod');
    expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled();
  });

  it('defaults the target schema to the first one loaded for the chosen connection', async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText('Connection to compare against'), 'Prod');
    expect(screen.getByLabelText('Schema to compare against')).toHaveValue('public');
  });

  it('calls onCompare with the chosen connection and schema, then closes', async () => {
    const onCompare = open();
    await userEvent.selectOptions(screen.getByLabelText('Connection to compare against'), 'Prod');
    await userEvent.selectOptions(screen.getByLabelText('Schema to compare against'), 'reporting');
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));

    expect(onCompare).toHaveBeenCalledWith('right-conn', 'reporting');
  });
});

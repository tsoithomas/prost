import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnMetadata } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { ImportModal } from './ImportModal';

const { mockParse, mockPreviewMutate, mockRun } = vi.hoisted(() => ({
  // Papa.parse(file, config) → synchronously feed a small sample to config.complete.
  mockParse: vi.fn((_file: unknown, config: { complete: (r: { data: string[][]; meta: { cursor: number } }) => void }) => {
    config.complete({ data: [['id', 'email'], ['1', 'a@x.com'], ['2', 'b@x.com']], meta: { cursor: 0 } });
  }),
  mockPreviewMutate: vi.fn((_req: unknown, opts: { onSuccess: (r: { sql: string; issues: string[] }) => void }) => {
    opts.onSuccess({ sql: 'INSERT INTO public.users (id, email) VALUES ($1, $2)', issues: [] });
  }),
  mockRun: vi.fn(() => Promise.resolve({ inserted: 2 })),
}));

vi.mock('papaparse', () => ({ default: { parse: mockParse } }));
vi.mock('../api/import', () => ({
  useImportPreview: () => ({ mutate: mockPreviewMutate, isPending: false }),
  useImportBatch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./useCsvImport', () => ({
  useCsvImport: () => ({ run: mockRun, cancel: vi.fn(), phase: 'idle', progress: { processedBytes: 0, totalBytes: 0, inserted: 0 }, error: null }),
}));
vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(true), dialog: null }),
}));

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
  { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

function upload() {
  const file = new File(['id,email\n1,a@x.com'], 'data.csv', { type: 'text/csv' });
  return userEvent.upload(screen.getByLabelText('CSV file'), file);
}

describe('ImportModal', () => {
  it('maps header columns, previews, and runs the streaming import', async () => {
    mockRun.mockClear();
    const onImported = vi.fn();
    renderWithProviders(
      <ImportModal open onClose={vi.fn()} connectionId="c1" schema="public" table="users" columns={COLUMNS} onImported={onImported} />,
    );

    await upload();
    // The header row auto-maps id→id, email→email.
    expect(screen.getByLabelText('Target for id')).toHaveValue('id');
    expect(screen.getByLabelText('Target for email')).toHaveValue('email');

    await userEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    expect(mockPreviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ schema: 'public', table: 'users', columns: ['id', 'email'] }),
      expect.any(Object),
    );

    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(File),
        { columns: ['id', 'email'], sourceIndices: [0, 1], hasHeader: true },
      ),
    );
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it('skips a column mapped to "— skip —"', async () => {
    mockRun.mockClear();
    mockPreviewMutate.mockClear();
    renderWithProviders(
      <ImportModal open onClose={vi.fn()} connectionId="c1" schema="public" table="users" columns={COLUMNS} />,
    );
    await upload();
    await userEvent.selectOptions(screen.getByLabelText('Target for email'), '');
    await userEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    expect(mockPreviewMutate.mock.calls[0]![0]).toMatchObject({ columns: ['id'] });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SchemaObjectDetail } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { DefinitionPanel } from './DefinitionPanel';

const { mockDefinition } = vi.hoisted(() => ({ mockDefinition: vi.fn() }));

vi.mock('../api/metadata', () => ({ useObjectDefinition: () => mockDefinition() }));

const DETAIL: SchemaObjectDetail = {
  kind: 'function',
  schema: 'public',
  name: 'total_sales',
  definition: 'CREATE FUNCTION total_sales() RETURNS int …',
  extra: { language: 'sql' },
};

describe('DefinitionPanel', () => {
  it('renders the kind badge, qualified name, definition source, and extras', () => {
    mockDefinition.mockReturnValue({ data: DETAIL, isLoading: false, isError: false });
    const { container } = renderWithProviders(
      <DefinitionPanel connectionId="c1" schema="public" objectKind="function" objectName="total_sales" />,
    );
    expect(container.textContent).toContain('Function');
    expect(container.textContent).toContain('public.total_sales');
    expect(container.textContent).toContain('CREATE FUNCTION total_sales() RETURNS int');
    expect(container.textContent).toContain('language');
    expect(container.textContent).toContain('sql');
  });

  it('shows a fallback when there is no definition and no extras', () => {
    mockDefinition.mockReturnValue({
      data: { kind: 'sequence', schema: 'public', name: 's' },
      isLoading: false,
      isError: false,
    });
    const { container } = renderWithProviders(
      <DefinitionPanel connectionId="c1" schema="public" objectKind="sequence" objectName="s" />,
    );
    expect(container.textContent).toContain('No definition available.');
    // No "Details" section when extra is absent.
    expect(container.textContent).not.toContain('Details');
  });
});

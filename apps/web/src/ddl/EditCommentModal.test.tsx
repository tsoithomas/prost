import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { useAiStore } from '../stores/aiStore';
import { EditCommentModal } from './EditCommentModal';

const { mockAlter, mockDescribe, mockPreview } = vi.hoisted(() => ({
  mockAlter: vi.fn(),
  mockDescribe: vi.fn(),
  mockPreview: vi.fn(),
}));

vi.mock('../api/ddl', () => ({ useAlterTable: () => mockAlter() }));
vi.mock('../api/ai', () => ({ useDescribeObject: () => mockDescribe() }));
vi.mock('../api/ddlPreview', () => ({ useDdlPreview: (...args: unknown[]) => mockPreview(...args) }));

function props(overrides: Partial<React.ComponentProps<typeof EditCommentModal>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    connectionId: 'c1',
    schema: 'public',
    table: 'users',
    current: 'Registered users',
    ...overrides,
  };
}

let alterMutate: ReturnType<typeof vi.fn>;
let describeMutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  alterMutate = vi.fn();
  describeMutate = vi.fn();
  mockAlter.mockReturnValue({ mutate: alterMutate, isPending: false, reset: vi.fn() });
  mockDescribe.mockReturnValue({ mutate: describeMutate, isPending: false, reset: vi.fn() });
  mockPreview.mockReturnValue({ sql: `COMMENT ON TABLE "public"."users" IS 'Registered users'` });
  useAiStore.setState({ selectedEndpointId: 'ep-1', selectedModel: 'gpt-4o' });
});

describe('EditCommentModal', () => {
  it('seeds the field with the current comment and shows the previewed SQL', () => {
    renderWithProviders(<EditCommentModal {...props()} />);

    expect(screen.getByLabelText('Description')).toHaveValue('Registered users');
    expect(screen.getByText(`COMMENT ON TABLE "public"."users" IS 'Registered users'`)).toBeInTheDocument();
  });

  it('previews a column comment against that column', () => {
    renderWithProviders(<EditCommentModal {...props({ column: 'email', current: null })} />);

    const [, body] = mockPreview.mock.calls.at(-1) as [string, { request: Record<string, unknown> }];
    expect(body.request).toMatchObject({ kind: 'setComment', columnName: 'email', schema: 'public', table: 'users' });
  });

  it('applies the edited text through the alter-table path', async () => {
    renderWithProviders(<EditCommentModal {...props({ current: null })} />);

    await userEvent.type(screen.getByLabelText('Description'), 'People who signed up');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(alterMutate).toHaveBeenCalledWith(
      { kind: 'setComment', comment: 'People who signed up' },
      expect.anything(),
    );
  });

  it('sends null when clearing a comment', async () => {
    renderWithProviders(<EditCommentModal {...props({ column: 'email' })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Clear comment' }));

    expect(alterMutate).toHaveBeenCalledWith(
      { kind: 'setComment', columnName: 'email', comment: null },
      expect.anything(),
    );
  });

  it('fills the field from an AI draft but still requires an explicit apply', async () => {
    describeMutate.mockImplementation((_req, opts: { onSuccess: (r: { comment: string }) => void }) =>
      opts.onSuccess({ comment: 'Everyone who registered.' }),
    );
    renderWithProviders(<EditCommentModal {...props({ current: null })} />);

    await userEvent.click(screen.getByRole('button', { name: /Draft with AI/ }));

    expect(describeMutate).toHaveBeenCalledWith(
      { endpointId: 'ep-1', model: 'gpt-4o', schema: 'public', table: 'users' },
      expect.anything(),
    );
    expect(screen.getByLabelText('Description')).toHaveValue('Everyone who registered.');
    // Drafting writes nothing on its own.
    expect(alterMutate).not.toHaveBeenCalled();
  });

  it('hides the AI affordance when no model is selected', () => {
    useAiStore.setState({ selectedEndpointId: null, selectedModel: null });
    renderWithProviders(<EditCommentModal {...props()} />);

    expect(screen.queryByRole('button', { name: /Draft with AI/ })).not.toBeInTheDocument();
  });

  it('surfaces a save failure', async () => {
    alterMutate.mockImplementation((_op, opts: { onError: (e: Error) => void }) =>
      opts.onError(new Error('nope')),
    );
    renderWithProviders(<EditCommentModal {...props({ current: null })} />);

    await userEvent.type(screen.getByLabelText('Description'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save the comment.');
  });
});

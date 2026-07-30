import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@prost/ui';

/** A trigger button that opens a Modal with a couple of focusable controls. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Test dialog">
        <input aria-label="first" />
        <button type="button">Inside</button>
      </Modal>
    </div>
  );
}

describe('Modal accessibility', () => {
  it('renders a labeled dialog and focuses the first focusable element on open', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByText('Open');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a backdrop click but not a panel click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    // Clicking inside the panel does not close.
    fireEvent.pointerDown(screen.getByText('Inside'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Clicking the backdrop (the dialog's parent overlay) closes.
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.pointerDown(overlay);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

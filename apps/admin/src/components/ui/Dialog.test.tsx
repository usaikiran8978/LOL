import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { ConfirmDialog } from './Dialog';

describe('ConfirmDialog with a typed confirmation phrase', () => {
  it('does nothing until the exact phrase is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog title="Delete" body="Irreversible" confirmLabel="Delete now" tone="danger" confirmPhrase="DELETE" onConfirm={onConfirm} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Delete now' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    await user.type(screen.getByLabelText(t('confirmText.label', { phrase: 'DELETE' }), { exact: false }), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete now' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });
});

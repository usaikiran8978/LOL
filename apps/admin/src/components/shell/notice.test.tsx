import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticeProvider, useNotify, useToast } from './notice';

function Triggers() {
  const notify = useNotify();
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => notify('Saved')}>ok</button>
      <button type="button" onClick={() => toast.error('Could not publish', 'Try again')}>fail</button>
    </>
  );
}

afterEach(() => vi.useRealTimers());

describe('NoticeProvider toasts', () => {
  it('stacks success and error toasts and dismisses them with the close button', async () => {
    const user = userEvent.setup();
    render(<NoticeProvider><Triggers /></NoticeProvider>);
    await user.click(screen.getByText('ok'));
    await user.click(screen.getByText('fail'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByText('Could not publish').closest('.toast')).toHaveClass('toast--error');
    expect(screen.getByText('Try again')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /close/i })[0]!);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Could not publish')).toBeInTheDocument();
  });

  it('auto-dismisses after six seconds', () => {
    vi.useFakeTimers();
    render(<NoticeProvider><Triggers /></NoticeProvider>);
    act(() => screen.getByText('ok').click());
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});

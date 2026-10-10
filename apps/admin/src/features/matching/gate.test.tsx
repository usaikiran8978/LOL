import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { routerMock } from '@/test/setup';
import { renderSignedIn } from '@/test/utils';
import { MatchingGate } from './MatchingGate';

describe('MatchingGate', () => {
  it('sends test-only admins from the module index to the test tool', async () => {
    await renderSignedIn(<MatchingGate index><p>versions</p></MatchingGate>, {}, ['matching.test']);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/matching/test'));
    expect(screen.queryByText('versions')).toBeNull();
  });

  it('blocks other matching pages without matching.view', async () => {
    await renderSignedIn(<MatchingGate><p>editor</p></MatchingGate>, {}, ['matching.test']);
    expect(screen.getByRole('alert')).toHaveTextContent(t('states.forbiddenTitle'));
    expect(screen.queryByText('editor')).toBeNull();
  });

  it('renders for matching.view', async () => {
    await renderSignedIn(<MatchingGate index><p>versions</p></MatchingGate>, {}, ['matching.view']);
    expect(screen.getByText('versions')).toBeInTheDocument();
  });
});

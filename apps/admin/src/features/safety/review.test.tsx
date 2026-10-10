import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState } from '@/test/setup';
import { apiError, renderSignedIn } from '@/test/utils';
import { MEDIA_ID, USER_ID, without, writes } from './fixtures';
import { ProfileReviewPage } from './ProfileReviewPage';
import { VerificationDetailPage } from './VerificationDetailPage';
import { VerificationQueuePage } from './VerificationQueuePage';

const QUEUE = {
  media: [{ id: MEDIA_ID, user_id: USER_ID, kind: 'photo', moderation_status: 'needs_review', created_at: '2026-10-08T08:00:00Z', url: 'https://cdn.test/p.jpg' }],
  prompts: [{ id: 'pr-1', user_id: USER_ID, answer: 'Text me on another app', created_at: '2026-10-08T08:00:00Z' }],
  profiles: [{ user_id: USER_ID, display_name: 'Sam', bio: 'Flagged bio', updated_at: '2026-10-08T08:00:00Z' }],
};

describe('ProfileReviewPage', () => {
  beforeEach(() => {
    navigationState.pathname = '/moderation/profile-review';
  });

  it('shows media, prompts and profiles awaiting review', async () => {
    const { calls } = await renderSignedIn(<ProfileReviewPage />, { 'GET /admin/profile-review/queue': () => QUEUE });
    expect(await screen.findByRole('img', { name: t('safety.review.mediaAlt', { n: 1, kind: t('safety.mediaKind.photo') }) })).toHaveAttribute('src', 'https://cdn.test/p.jpg');
    expect(screen.getByText('Text me on another app')).toBeInTheDocument();
    expect(screen.getByText('Flagged bio')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/admin/profile-review/queue')!.query.get('limit')).toBe('50');
  });

  it('rejects media with a reason and approves a prompt and a profile', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ProfileReviewPage />, {
      'GET /admin/profile-review/queue': () => QUEUE,
      [`POST /admin/profile-review/media/${MEDIA_ID}`]: () => new Response(null, { status: 204 }),
      'POST /admin/profile-review/prompts/pr-1': () => new Response(null, { status: 204 }),
      [`POST /admin/profile-review/profiles/${USER_ID}`]: () => new Response(null, { status: 204 }),
    });
    const mediaName = t('safety.review.mediaAlt', { n: 1, kind: t('safety.mediaKind.photo') });
    await user.click(await screen.findByRole('button', { name: `${t('safety.review.reject')} ${mediaName}` }));
    let d = screen.getByRole('dialog', { name: t('safety.review.rejectTitle', { name: mediaName }) });
    await user.type(within(d).getByLabelText(t('safety.review.reasonKey')), 'nudity');
    await user.click(within(d).getByRole('button', { name: t('safety.review.reject') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ path: `/admin/profile-review/media/${MEDIA_ID}`, body: { decision: 'rejected', reasonKey: 'nudity' } });
    expect(await screen.findByText(t('safety.review.rejectedDone'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${t('safety.review.approve')} ${t('safety.review.promptN', { n: 1 })}` }));
    d = screen.getByRole('dialog');
    expect(within(d).queryByLabelText(t('safety.review.reasonKey'))).not.toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: t('safety.review.approve') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({ path: '/admin/profile-review/prompts/pr-1', body: { decision: 'approved' } });

    await user.click(screen.getByRole('button', { name: `${t('safety.review.reject')} Sam` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('safety.review.reject') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(3));
    expect(writes(calls)[2]).toMatchObject({ path: `/admin/profile-review/profiles/${USER_ID}`, body: { decision: 'rejected' } });
  });

  it('shows empty sections, the error state and gating', async () => {
    const user = userEvent.setup();
    let fail = true;
    const first = await renderSignedIn(<ProfileReviewPage />, { 'GET /admin/profile-review/queue': () => (fail ? apiError(500, 'INTERNAL') : { media: [], prompts: [], profiles: [] }) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('safety.review.mediaEmpty'))).toBeInTheDocument();
    expect(screen.getByText(t('safety.review.promptsEmpty'))).toBeInTheDocument();
    expect(screen.getByText(t('safety.review.profilesEmpty'))).toBeInTheDocument();
    first.unmount();
    await renderSignedIn(<ProfileReviewPage />, {}, without('profiles.review'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});

const REQUEST = {
  id: 'vr-1', user_id: USER_ID, kind: 'selfie', status: 'needs_review', provider: 'manual_review', provider_ref: null, pose_challenge: 'peace_sign', evidence_keys: ['v/k'],
  liveness_score: null, face_match_score: 0.93, document_country: null, rejection_reason_key: null, reviewer_id: null, submitted_at: '2026-10-08T08:00:00Z', decided_at: null,
  expires_at: null, evidence_purged_at: null, evidence: ['https://cdn.test/selfie.jpg'], profilePhotos: [{ id: 'ph1', url: 'https://cdn.test/ph1.jpg' }],
};

describe('Verification', () => {
  beforeEach(() => {
    navigationState.pathname = '/verification';
  });

  it('lists the queue and links to each request', async () => {
    await renderSignedIn(<VerificationQueuePage />, { 'GET /admin/verification/queue': () => ({ items: [{ id: 'vr-1', user_id: USER_ID, display_name: 'Sam', kind: 'selfie', status: 'needs_review', provider: 'manual_review', pose_challenge: 'wave', submitted_at: '2026-10-08T08:00:00Z' }], nextCursor: null }) });
    expect(await screen.findByText(t('safety.pose.wave'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${t('safety.verification.review')} Sam` })).toHaveAttribute('href', '/verification/vr-1');
  });

  it('pages the queue with the cursor', async () => {
    const user = userEvent.setup();
    const row = (id: string, name: string) => ({ id, user_id: USER_ID, display_name: name, kind: 'selfie', status: 'needs_review', provider: 'manual_review', pose_challenge: null, submitted_at: '2026-10-08T08:00:00Z' });
    const { calls } = await renderSignedIn(<VerificationQueuePage />, {
      'GET /admin/verification/queue': (c) => (c.query.get('cursor') === 'next-1' ? { items: [row('vr-2', 'Kim')], nextCursor: null } : { items: [row('vr-1', 'Sam')], nextCursor: 'next-1' }),
    });
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Kim')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText(t('common.endOfList'))).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/verification/queue').at(-1)!.query.get('cursor')).toBe('next-1');
  });

  it('shows queue empty and error states', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<VerificationQueuePage />, { 'GET /admin/verification/queue': () => (fail ? apiError(500, 'INTERNAL') : { items: [], nextCursor: null }) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('safety.verification.empty'))).toBeInTheDocument();
  });

  it('shows evidence next to profile photos and approves after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<VerificationDetailPage requestId="vr-1" />, {
      'GET /admin/verification/vr-1': () => REQUEST,
      'POST /admin/verification/vr-1/decision': () => new Response(null, { status: 204 }),
    });
    expect(await screen.findByRole('img', { name: t('safety.verification.evidenceAlt', { n: 1 }) })).toHaveAttribute('src', 'https://cdn.test/selfie.jpg');
    expect(screen.getByRole('img', { name: t('safety.verification.photoAlt', { n: 1 }) })).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('safety.verification.approve') }));
    await user.click(within(screen.getByRole('dialog', { name: t('safety.verification.approveTitle') })).getByRole('button', { name: t('safety.verification.approve') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ decision: 'approved' });
  });

  it('requires a rejection reason', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<VerificationDetailPage requestId="vr-1" />, {
      'GET /admin/verification/vr-1': () => REQUEST,
      'POST /admin/verification/vr-1/decision': () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: t('safety.verification.reject') }));
    const d = screen.getByRole('dialog', { name: t('safety.verification.rejectTitle') });
    await user.click(within(d).getByRole('button', { name: t('safety.verification.reject') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.selectOptions(within(d).getByLabelText(t('safety.verification.rejectionReason'), { exact: false }), 'pose_not_followed');
    await user.click(within(d).getByRole('button', { name: t('safety.verification.reject') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ decision: 'rejected', rejectionReasonKey: 'pose_not_followed' });
  });

  it('hides evidence without view_evidence and decisions without verification.decide', async () => {
    await renderSignedIn(<VerificationDetailPage requestId="vr-1" />, { 'GET /admin/verification/vr-1': () => ({ ...REQUEST, evidence: null }) }, ['verification.view']);
    expect(await screen.findByText(t('safety.verification.evidenceHidden'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('safety.verification.approve') })).not.toBeInTheDocument();
    expect(screen.getByText(t('safety.verification.noDecide'))).toBeInTheDocument();
  });

  it('does not offer decisions on decided requests and forbids without verification.view', async () => {
    const first = await renderSignedIn(<VerificationDetailPage requestId="vr-1" />, { 'GET /admin/verification/vr-1': () => ({ ...REQUEST, status: 'approved', evidence: [], evidence_purged_at: '2026-10-09T00:00:00Z' }) });
    expect(await screen.findByText(t('safety.verification.alreadyDecided', { status: t('safety.verificationStatus.approved') }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('safety.verification.approve') })).not.toBeInTheDocument();
    first.unmount();
    await renderSignedIn(<VerificationQueuePage />, {}, without('verification.view'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});

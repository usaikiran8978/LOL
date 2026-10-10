import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState } from '@/test/setup';
import { apiError, renderSignedIn, type RecordedCall } from '@/test/utils';
import { CaseDetailPage } from './CaseDetailPage';
import { ACTION_ID, CASE_ID, caseDetail, MEDIA_ID, OTHER_ADMIN, USER_ID, without, writes } from './fixtures';

beforeEach(() => {
  navigationState.pathname = `/moderation/cases/${CASE_ID}`;
});

const base = (detail = caseDetail()) => ({
  [`GET /admin/moderation/cases/${CASE_ID}`]: () => detail,
  [`GET /admin/users/${USER_ID}`]: () => ({ safety: { riskScore: { score: 0.42, components: { signals: { scam: 2 }, reporters: 3 }, computed_at: '2026-10-08T10:00:00Z' } } }),
  [`PUT /admin/moderation/cases/${CASE_ID}`]: (c: RecordedCall) => ({ ...detail, ...(c.body as object) }),
  [`POST /admin/moderation/cases/${CASE_ID}/actions`]: () => ({ actionId: 'new-action' }),
  [`POST /admin/moderation/cases/${CASE_ID}/notes`]: () => ({ id: 'n2' }),
  [`POST /admin/moderation/actions/${ACTION_ID}/reverse`]: () => ({ reversalActionId: 'rev-1' }),
});

describe('CaseDetailPage — evidence and context', () => {
  it('shows summary, reports, message evidence, signals, notes and the risk score', async () => {
    await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    expect(await screen.findByRole('heading', { name: t('safety.detail.title', { category: t('safety.category.scam') }) })).toBeInTheDocument();
    expect(screen.getByText('Asked me for money')).toBeInTheDocument();
    expect(screen.getByText('Send me 500 euros')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t('safety.evidence.mediaAlt', { n: 2 }) })).toHaveAttribute('src', 'https://cdn.test/m.jpg');
    expect(screen.getByText('First look done')).toBeInTheDocument();
    expect(screen.getByText('text_moderation')).toBeInTheDocument();
    expect(await screen.findByText('42%')).toBeInTheDocument();
  });

  it('shows the redaction notice for message evidence and hides the risk score without permissions', async () => {
    const detail = caseDetail();
    detail.evidence[0]!.snapshot = { redacted: true };
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base(detail), without('moderation.view_messages', 'users.view_safety_history'));
    expect(await screen.findByText(t('safety.evidence.redacted'))).toBeInTheDocument();
    expect(screen.queryByText('Send me 500 euros')).not.toBeInTheDocument();
    expect(screen.getByText(t('safety.risk.noPermission'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === `/admin/users/${USER_ID}`)).toBe(false);
  });

  it('shows the error state with retry', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, { ...base(), [`GET /admin/moderation/cases/${CASE_ID}`]: () => (fail ? apiError(404, 'NOT_FOUND') : caseDetail()) });
    expect(await screen.findByText(t('errors.NOT_FOUND'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('Asked me for money')).toBeInTheDocument();
  });

  it('forbids the page without moderation.view', async () => {
    await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base(), without('moderation.view'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});

describe('CaseDetailPage — workflow', () => {
  it('assigns the case to the signed-in admin', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base(), ['moderation.view']);
    await user.click(await screen.findByRole('button', { name: t('safety.detail.assignToMe') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: 'PUT', path: `/admin/moderation/cases/${CASE_ID}`, body: { assignTo: 'me' } });
    expect(await screen.findByText(t('safety.detail.assigned'))).toBeInTheDocument();
    // moderation.view alone: no enforcement actions, no reversal.
    expect(screen.queryByRole('button', { name: t('safety.detail.takeAction') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`^${t('safety.history.reverse')}`) })).not.toBeInTheDocument();
  });

  it('limits status and assignment options by permission', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base(), ['moderation.view']);
    await user.click(await screen.findByRole('button', { name: t('safety.detail.update') }));
    const d = screen.getByRole('dialog');
    const status = within(d).getByLabelText(t('safety.cases.status'));
    expect(within(status).queryByRole('option', { name: t('safety.caseStatus.escalated') })).not.toBeInTheDocument();
    const assign = within(d).getByLabelText(t('safety.update.assignment'));
    expect(within(assign).queryByRole('option', { name: t('safety.update.unassign') })).not.toBeInTheDocument();
    expect(within(d).getByText(t('safety.update.assignNeedsPermission'))).toBeInTheDocument();
  });

  it('dismisses a case after confirmation with severity and assignment changes', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    await user.click(await screen.findByRole('button', { name: t('safety.detail.update') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('safety.cases.status')), 'dismissed');
    await user.selectOptions(within(d).getByLabelText(t('safety.cases.severity')), 'low');
    await user.type(within(d).getByLabelText(t('safety.update.resolutionKey')), 'no_violation');
    await user.selectOptions(within(d).getByLabelText(t('safety.update.assignment')), 'other');
    await user.type(within(d).getByLabelText(t('safety.update.assigneeId'), { exact: false }), OTHER_ADMIN);
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('safety.update.confirmCloseTitle', { status: t('safety.caseStatus.dismissed') }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('common.confirm') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ status: 'dismissed', severity: 'low', resolutionKey: 'no_violation', assignTo: OTHER_ADMIN });
  });

  it('adds a note', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    await user.click(await screen.findByRole('button', { name: t('safety.notes.add') }));
    expect(writes(calls)).toHaveLength(0);
    await user.type(screen.getByLabelText(t('safety.notes.body'), { exact: false }), 'Checked device links');
    await user.click(screen.getByRole('button', { name: t('safety.notes.add') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ path: `/admin/moderation/cases/${CASE_ID}/notes`, body: { body: 'Checked device links' } });
  });
});

describe('CaseDetailPage — enforcement', () => {
  it('requires a duration for suspensions and sends only the relevant fields after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    await user.click(await screen.findByRole('button', { name: t('safety.detail.takeAction') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('safety.action.action'), { exact: false }), 'suspend');
    await user.type(within(d).getByLabelText(t('safety.action.reasonKey'), { exact: false }), 'scam_behaviour');
    await user.click(within(d).getByRole('button', { name: t('safety.action.review') }));
    expect(within(d).getByLabelText(t('safety.action.durationHours'), { exact: false })).toHaveAttribute('aria-invalid', 'true');
    await user.type(within(d).getByLabelText(t('safety.action.durationHours'), { exact: false }), '72');
    await user.click(within(d).getByRole('button', { name: t('safety.action.review') }));
    const confirm = screen.getByRole('dialog', { name: t('safety.action.confirmTitle', { action: t('safety.actionType.suspend') }) });
    await user.click(within(confirm).getByRole('button', { name: t('safety.actionType.suspend') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ path: `/admin/moderation/cases/${CASE_ID}/actions`, body: { action: 'suspend', reasonKey: 'scam_behaviour', durationHours: 72, notifyUser: true } });
  });

  it('removes content picked from the evidence', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    await user.click(await screen.findByRole('button', { name: t('safety.detail.takeAction') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('safety.action.action'), { exact: false }), 'remove_content');
    await user.type(within(d).getByLabelText(t('safety.action.reasonKey'), { exact: false }), 'nudity');
    await user.selectOptions(within(d).getByLabelText(t('safety.action.fromEvidence')), 'ev2');
    await user.click(within(d).getByLabelText(t('safety.action.notifyUser')));
    await user.click(within(d).getByRole('button', { name: t('safety.action.review') }));
    await user.click(within(screen.getByRole('dialog', { name: t('safety.action.confirmTitle', { action: t('safety.actionType.remove_content') }) })).getByRole('button', { name: t('safety.actionType.remove_content') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ action: 'remove_content', reasonKey: 'nudity', contentType: 'media', contentId: MEDIA_ID, notifyUser: false });
  });

  it('requires the typed phrase before banning', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    await user.click(await screen.findByRole('button', { name: t('safety.detail.takeAction') }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('safety.action.action'), { exact: false }), 'ban');
    await user.type(within(d).getByLabelText(t('safety.action.reasonKey'), { exact: false }), 'fraud');
    await user.click(within(d).getByRole('button', { name: t('safety.action.review') }));
    const confirm = screen.getByRole('dialog', { name: t('safety.action.confirmTitle', { action: t('safety.actionType.ban') }) });
    await user.click(within(confirm).getByRole('button', { name: t('safety.actionType.ban') }));
    expect(within(confirm).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.type(within(confirm).getByLabelText(t('confirmText.label', { phrase: t('safety.action.banPhrase') }), { exact: false }), t('safety.action.banPhrase'));
    await user.click(within(confirm).getByRole('button', { name: t('safety.actionType.ban') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ action: 'ban', reasonKey: 'fraud' });
  });

  it('hides ban/unban without moderation.ban and escalate without moderation.escalate', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base(), without('moderation.ban', 'moderation.escalate'));
    await user.click(await screen.findByRole('button', { name: t('safety.detail.takeAction') }));
    const select = within(screen.getByRole('dialog')).getByLabelText(t('safety.action.action'), { exact: false });
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain('ban');
    expect(options).not.toContain('unban');
    expect(options).not.toContain('escalate');
    expect(options).toContain('suspend');
    // Reversing the old ban is hidden too; the restriction can still be reversed.
    expect(screen.getAllByRole('button', { name: new RegExp(`^${t('safety.history.reverse')}`) })).toHaveLength(1);
  });

  it('reverses an action with a mandatory reason', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CaseDetailPage caseId={CASE_ID} />, base());
    const buttons = await screen.findAllByRole('button', { name: new RegExp(`^${t('safety.history.reverse')} ${t('safety.actionType.restrict')}`) });
    await user.click(buttons[0]!);
    const confirm = screen.getByRole('dialog', { name: t('safety.history.reverseTitle', { action: t('safety.actionType.restrict') }) });
    expect(within(confirm).getByText(t('safety.history.reverseBody', { inverse: t('safety.actionType.lift_restriction') }))).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: t('safety.history.reverse') }));
    expect(within(confirm).getByText(t('validation.required'))).toBeInTheDocument();
    await user.type(within(confirm).getByLabelText(t('safety.history.reverseReason'), { exact: false }), 'Wrong account');
    await user.click(within(confirm).getByRole('button', { name: t('safety.history.reverse') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ path: `/admin/moderation/actions/${ACTION_ID}/reverse`, body: { note: 'Wrong account' } });
  });
});

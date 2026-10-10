import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import type { AdminEventRow } from '@/lib/api/modules/events';
import { apiError, field, renderSignedIn, type RecordedCall } from '@/test/utils';
import { EventsPage } from './EventsPage';

const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/admin/auth'));

const pending: AdminEventRow = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Board games night', status: 'pending_review', organizer_type: 'user', organizer_user_id: 'u1',
  starts_at: '2026-11-01T18:00:00Z', ends_at: '2026-11-01T21:00:00Z', capacity: null, price_minor: 0, currency: null, moderation_note: 'auto-flag: spam', city: 'Paris', country_code: 'FR',
  registered_count: 0, waitlist_count: 0, checked_in_count: 0,
};
const live: AdminEventRow = {
  ...pending, id: '22222222-2222-4222-8222-222222222222', title: 'Speed dating', status: 'published', organizer_type: 'platform', organizer_user_id: null, moderation_note: null,
  capacity: 20, price_minor: '1500', currency: 'EUR', registered_count: 12, waitlist_count: 3, checked_in_count: 5,
};
const done: AdminEventRow = { ...live, id: '33333333-3333-4333-8333-333333333333', title: 'Old mixer', status: 'completed' };

const MANAGER = ['events.view', 'events.manage'] as const;
const page = (items: AdminEventRow[], nextCursor: string | null = null) => ({ items, nextCursor });
const ATTENDEE = '44444444-4444-4444-8444-444444444444';
const OTHER = '77777777-7777-4777-8777-777777777777';
const CITY = '55555555-5555-4555-8555-555555555555';
const liveDetail = {
  id: live.id, title: 'Speed dating', description: 'Ten short dates and a welcome drink.', status: 'published', organizer_type: 'platform', organizer_user_id: null, category_key: 'dating_mixer',
  city_id: CITY, city: 'Paris', country_code: 'FR', venue_name: 'Le Bar', venue_address: '1 Rue X', latitude: '48.8566', longitude: '2.3522', is_online: false,
  starts_at: live.starts_at, ends_at: live.ends_at, timezone: 'Europe/Paris', capacity: 20, min_age: 25, max_age: 40, visibility: 'public', pre_event_matching: false,
  chat_enabled: true, price_minor: '1500', currency: 'EUR', moderation_note: null, interest_ids: [],
};
const roster = [
  { userId: ATTENDEE, displayName: 'Noa', verificationLevel: 'selfie', status: 'registered', checkedInAt: null, registeredAt: '2026-10-01T10:00:00Z' },
  { userId: OTHER, displayName: 'Lior', verificationLevel: 'none', status: 'checked_in', checkedInAt: '2026-11-01T18:05:00Z', registeredAt: '2026-10-02T10:00:00Z' },
  { userId: '88888888-8888-4888-8888-888888888888', displayName: 'Maya', verificationLevel: null, status: 'waitlisted', checkedInAt: null, registeredAt: '2026-10-03T10:00:00Z' },
];

describe('EventsPage list', () => {
  it('loads events and filters by status through the API', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, { 'GET /admin/events': (c) => (c.query.get('status') === 'published' ? page([live]) : page([pending, live, done])) }, [...MANAGER]);
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
    expect(await screen.findByText('Board games night')).toBeInTheDocument();
    expect(within(screen.getByText('Board games night').closest('tr')!).getByText(t('events.status.pending_review'))).toBeInTheDocument();
    expect(screen.getByText('auto-flag: spam')).toBeInTheDocument();
    expect(screen.getByText(t('events.organizer.user'))).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(t('events.filters.status')), 'published');
    await waitFor(() => expect(screen.queryByText('Board games night')).toBeNull());
    expect(screen.getByText('Speed dating')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/events').at(-1)!.query.get('status')).toBe('published');
  });

  it('offers only the decisions valid for each status', async () => {
    await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([pending, live, done]) }, [...MANAGER]);
    await screen.findByText('Board games night');
    const name = (k: string, title: string) => `${t(k as Parameters<typeof t>[0])} ${title}`;
    expect(screen.getByRole('button', { name: name('events.decision.publish.action', 'Board games night') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: name('events.decision.reject.action', 'Board games night') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: name('events.checkIn.action', 'Board games night') })).toBeNull();
    expect(screen.queryByRole('button', { name: name('events.decision.publish.action', 'Speed dating') })).toBeNull();
    expect(screen.getByRole('button', { name: name('events.decision.cancel.action', 'Speed dating') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: name('events.checkIn.action', 'Speed dating') })).toBeInTheDocument();
    const oldRow = screen.getByText('Old mixer').closest('tr')!;
    // Completed events: details only.
    expect(within(oldRow).getAllByRole('button').map((b) => b.textContent)).toEqual([t('events.detail.action')]);
  });

  it('shows empty and error states with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => (fail ? apiError(500, 'INTERNAL') : page([])) }, [...MANAGER]);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('events.empty'))).toBeInTheDocument();
  });

  it('is read-only with events.view only', async () => {
    await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([pending, live]) }, ['events.view']);
    await screen.findByText('Board games night');
    expect(screen.queryByRole('button', { name: t('events.create') })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(t('events.decision.publish.action')) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(t('events.checkIn.action')) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(t('events.edit.action')) })).toBeNull();
    expect(screen.getByRole('button', { name: `${t('events.detail.action')} Speed dating` })).toBeInTheDocument();
  });

  it('shows end time, attendance against capacity, waitlist, check-ins and price', async () => {
    await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([pending, live]) }, [...MANAGER]);
    const row = (await screen.findByText('Speed dating')).closest('tr')!;
    expect(within(row).getByText(t('events.attendance', { registered: '12', capacity: '20' }))).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('5')).toBeInTheDocument();
    expect(within(row).getByText(/15\.00/)).toBeInTheDocument();
    expect(within(row).getByText(new RegExp(t('events.until', { at: '' }).trim()))).toBeInTheDocument();
    const free = screen.getByText('Board games night').closest('tr')!;
    expect(within(free).getByText(t('events.attendance', { registered: '0', capacity: t('events.unlimited') }))).toBeInTheDocument();
    expect(within(free).getByText(t('events.free'))).toBeInTheDocument();
  });

  it('pages with the cursor and keeps the status filter', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': (c) => (c.query.get('cursor') === 'n2' ? page([done]) : page([pending, live], 'n2')),
    }, [...MANAGER]);
    await screen.findByText('Board games night');
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Old mixer')).toBeInTheDocument();
    expect(screen.getByText('Board games night')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/events').at(-1)!.query.get('cursor')).toBe('n2');
    expect(screen.getByText(t('common.endOfList'))).toBeInTheDocument();
  });
});

describe('EventsPage actions', () => {
  it('publishes with an optional note after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([pending]), [`POST /admin/events/${pending.id}/decision`]: () => new Response(null, { status: 204 }) }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.decision.publish.action')} Board games night` }));
    const d = screen.getByRole('dialog', { name: t('events.decision.publish.title', { title: 'Board games night' }) });
    await user.type(within(d).getByLabelText(t('events.decision.note')), 'Looks good');
    await user.click(within(d).getByRole('button', { name: t('events.decision.publish.action') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ decision: 'publish', note: 'Looks good' });
    expect(await screen.findByText(t('events.decision.publish.done', { title: 'Board games night' }))).toBeInTheDocument();
    // The list is reloaded after the decision.
    await waitFor(() => expect(calls.filter((c) => c.path === '/admin/events')).toHaveLength(2));
  });

  it('requires the typed phrase to cancel an event', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([live]), [`POST /admin/events/${live.id}/decision`]: () => new Response(null, { status: 204 }) }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.decision.cancel.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('events.decision.cancel.action') }));
    expect(within(d).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: t('events.decision.cancelPhrase') }), { exact: false }), t('events.decision.cancelPhrase'));
    await user.click(within(d).getByRole('button', { name: t('events.decision.cancel.action') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ decision: 'cancel' });
  });

  it('shows a conflict from the API inside the decision dialog', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([pending]), [`POST /admin/events/${pending.id}/decision`]: () => apiError(409, 'CONFLICT') }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.decision.reject.action')} Board games night` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('events.decision.reject.action') }));
    expect(await within(d).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
  });

  it('checks an attendee in with the code alone', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([live]), [`POST /admin/events/${live.id}/check-in`]: () => new Response(null, { status: 204 }) }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.checkIn.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    await user.type(field(t('events.checkIn.code')), 'ab1');
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.clear(field(t('events.checkIn.code')));
    await user.type(field(t('events.checkIn.code')), 'ab12cd');
    expect(field(t('events.checkIn.code'))).toHaveValue('AB12CD');
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ code: 'AB12CD' });
    expect(await screen.findByText(t('events.checkIn.done'))).toBeInTheDocument();
  });

  it('asks to pick the attendee from the roster when the code is ambiguous', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live]),
      [`GET /admin/events/${live.id}/attendees`]: () => roster,
      [`POST /admin/events/${live.id}/check-in`]: (c) => ((c.body as { userId?: string }).userId ? new Response(null, { status: 204 }) : apiError(400, 'VALIDATION_FAILED', { ambiguous: true })),
    }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.checkIn.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    await user.type(field(t('events.checkIn.code')), 'AB12CD');
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    expect(await within(d).findByText(t('events.checkIn.ambiguous'))).toBeInTheDocument();
    const picker = await within(d).findByLabelText(new RegExp(`^${t('events.checkIn.pickAttendee')}`));
    // Only registered attendees can be checked in.
    expect(within(picker).getAllByRole('option')).toHaveLength(2);
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(1);
    await user.selectOptions(picker, ATTENDEE);
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]!.body).toEqual({ code: 'AB12CD', userId: ATTENDEE });
    expect(await screen.findByText(t('events.checkIn.done'))).toBeInTheDocument();
  }, 15_000);

  it('explains a wrong code, an attendee already checked in and EVENT_NOT_OPEN', async () => {
    const user = userEvent.setup();
    let reply = apiError(400, 'VALIDATION_FAILED', { invalidCode: true });
    await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([live]), [`POST /admin/events/${live.id}/check-in`]: () => reply.clone() }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.checkIn.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    await user.type(field(t('events.checkIn.code')), 'AB12CD');
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    expect(await within(d).findByText(t('events.checkIn.invalidCode'))).toBeInTheDocument();
    reply = apiError(409, 'CONFLICT', { alreadyCheckedIn: true });
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    expect(await within(d).findByText(t('events.checkIn.alreadyCheckedIn'))).toBeInTheDocument();
    reply = apiError(409, 'EVENT_NOT_OPEN');
    await user.click(within(d).getByRole('button', { name: t('events.checkIn.action') }));
    expect(await within(d).findByText(t('errors.EVENT_NOT_OPEN'))).toBeInTheDocument();
  });
});

describe('Event detail and roster', () => {
  it('shows the full roster and checks in from a row', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live]),
      [`GET /admin/events/${live.id}`]: () => liveDetail,
      [`GET /admin/events/${live.id}/attendees`]: () => roster,
      [`POST /admin/events/${live.id}/check-in`]: () => new Response(null, { status: 204 }),
    }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.detail.action')} Speed dating` }));
    expect(await screen.findByText('Ten short dates and a welcome drink.')).toBeInTheDocument();
    expect(screen.getByText('Le Bar, 1 Rue X')).toBeInTheDocument();
    expect(screen.getByText(t('events.detail.ageRange', { min: 25, max: 40 }))).toBeInTheDocument();
    const d = screen.getByRole('dialog', { name: t('events.detail.title', { title: 'Speed dating' }) });
    expect(await within(d).findByText('Noa')).toBeInTheDocument();
    expect(within(d).getByText('Lior')).toBeInTheDocument();
    expect(within(d).getByText(t('events.roster.status.waitlisted'))).toBeInTheDocument();
    // Only the registered attendee gets a check-in button.
    expect(within(d).getByRole('button', { name: `${t('events.checkIn.action')} Noa` })).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: `${t('events.checkIn.action')} Lior` })).toBeNull();
    expect(within(d).queryByRole('button', { name: `${t('events.checkIn.action')} Maya` })).toBeNull();
    await user.click(within(d).getByRole('button', { name: `${t('events.checkIn.action')} Noa` }));
    const ci = screen.getByRole('dialog', { name: t('events.checkIn.title', { title: 'Speed dating' }) });
    expect(within(ci).getByDisplayValue('Noa')).toBeInTheDocument();
    await user.type(within(ci).getByLabelText(t('events.checkIn.code'), { exact: false }), 'ZZ99YY');
    await user.click(within(ci).getByRole('button', { name: t('events.checkIn.action') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ code: 'ZZ99YY', userId: ATTENDEE });
    expect(await screen.findByText(t('events.checkIn.doneNamed', { name: 'Noa' }))).toBeInTheDocument();
    // The roster is reloaded after the check-in.
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/attendees'))).toHaveLength(2));
  }, 15_000);

  it('shows roster empty and error states', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live]),
      [`GET /admin/events/${live.id}`]: () => liveDetail,
      [`GET /admin/events/${live.id}/attendees`]: () => (fail ? apiError(500, 'INTERNAL') : []),
    }, ['events.view']);
    await user.click(await screen.findByRole('button', { name: `${t('events.detail.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    expect(await within(d).findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(within(d).getByRole('button', { name: t('common.retry') }));
    expect(await within(d).findByText(t('events.roster.empty'))).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: t('events.checkIn.byCode') })).toBeNull();
    expect(within(d).queryByRole('button', { name: t('events.edit.action') })).toBeNull();
  });
});

describe('Edit event', () => {
  it('prefills every field from the detail, sends only changes and confirms when attendees will be notified', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live]),
      [`GET /admin/events/${live.id}`]: () => liveDetail,
      [`PUT /admin/events/${live.id}`]: () => ({ id: live.id }),
    }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.edit.action')} Speed dating` }));
    const d = screen.getByRole('dialog', { name: t('events.edit.title', { title: 'Speed dating' }) });
    expect(await within(d).findByText(t('events.edit.notifyNote'))).toBeInTheDocument();
    expect(field(t('events.form.eventTitle'))).toHaveValue('Speed dating');
    expect(field(t('events.form.description'))).toHaveValue('Ten short dates and a welcome drink.');
    expect(field(t('events.form.timezone'))).toHaveValue('Europe/Paris');
    expect(field(t('events.form.cityId'))).toHaveValue(CITY);
    expect(within(d).getByLabelText(t('events.form.venueName'))).toHaveValue('Le Bar');
    expect(within(d).getByLabelText(t('events.form.latitude'))).toHaveValue(48.8566);
    expect(within(d).getByLabelText(t('events.form.minAge'))).toHaveValue(25);
    expect(within(d).getByLabelText(t('events.form.capacity'))).toHaveValue(20);
    expect(within(d).getByLabelText(t('events.form.priceMinor'))).toHaveValue(1500);
    expect(within(d).getByLabelText(t('events.form.chatEnabled'))).toBeChecked();

    // Nothing changed → nothing is sent.
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('events.edit.nothingChanged'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(field(t('events.form.startsAt')), { target: { value: '2026-11-02T19:00' } });
    await user.clear(within(d).getByLabelText(t('events.form.venueName')));
    await user.type(within(d).getByLabelText(t('events.form.venueName')), 'Chez Nous');
    await user.type(within(d).getByLabelText(t('events.edit.changeNote')), 'Moved to Monday');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('events.edit.confirmTitle', { title: 'Speed dating' }) });
    expect(within(confirm).getByText(t('events.edit.confirmBody', { count: '15' }))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('events.edit.confirmAction') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ startsAt: new Date('2026-11-02T19:00').toISOString(), venueName: 'Chez Nous', changeNote: 'Moved to Monday' });
    expect(await screen.findByText(t('events.edit.saved', { title: 'Speed dating' }))).toBeInTheDocument();
  }, 20_000);

  it('clears capacity (unlimited) and age bounds with null without the notification confirm', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live]),
      [`GET /admin/events/${live.id}`]: () => liveDetail,
      [`PUT /admin/events/${live.id}`]: () => ({ id: live.id }),
    }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.edit.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    await user.clear(await within(d).findByLabelText(t('events.form.capacity')));
    await user.clear(within(d).getByLabelText(t('events.form.minAge')));
    await user.clear(within(d).getByLabelText(t('events.form.maxAge')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    // No time/place change → saved without the notification confirm.
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ capacity: null, minAge: null, maxAge: null });
  }, 15_000);

  it('confirms coordinate-only changes and clears them with null', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live]),
      [`GET /admin/events/${live.id}`]: () => liveDetail,
      [`PUT /admin/events/${live.id}`]: () => ({ id: live.id }),
    }, [...MANAGER]);
    await user.click(await screen.findByRole('button', { name: `${t('events.edit.action')} Speed dating` }));
    const d = screen.getByRole('dialog');
    await user.clear(await within(d).findByLabelText(t('events.form.latitude')));
    await user.clear(within(d).getByLabelText(t('events.form.longitude')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    const confirm = screen.getByRole('dialog', { name: t('events.edit.confirmTitle', { title: 'Speed dating' }) });
    await user.click(within(confirm).getByRole('button', { name: t('events.edit.confirmAction') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ latitude: null, longitude: null });
  }, 15_000);

  it('shows detail load errors with retry, API conflicts, and is not offered for completed events', async () => {
    const user = userEvent.setup();
    let fail = true;
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([live, done]),
      [`GET /admin/events/${live.id}`]: () => (fail ? apiError(500, 'INTERNAL') : liveDetail),
      [`PUT /admin/events/${live.id}`]: () => apiError(409, 'CONFLICT'),
    }, [...MANAGER]);
    await screen.findByText('Speed dating');
    expect(screen.queryByRole('button', { name: `${t('events.edit.action')} Old mixer` })).toBeNull();
    await user.click(screen.getByRole('button', { name: `${t('events.edit.action')} Speed dating` }));
    const loading = screen.getByRole('dialog');
    expect(await within(loading).findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(within(loading).getByRole('button', { name: t('common.retry') }));
    const capacity = await screen.findByLabelText(t('events.form.capacity'));
    await user.clear(capacity);
    await user.type(capacity, '10');
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ capacity: 10 });
    expect(await within(d).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
  }, 15_000);
});

describe('Create event', () => {
  const cityId = '55555555-5555-4555-8555-555555555555';
  const interestId = '66666666-6666-4666-8666-666666666666';

  function setDateTime(label: string, value: string) {
    fireEvent.change(field(label), { target: { value } });
  }

  it('creates a platform event with pickers after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, {
      'GET /admin/events': () => page([]),
      'GET /admin/taxonomy/terms': () => [
        { id: 'c1', kind: 'event_category', key: 'dating_mixer', parent_id: null, position: 0, is_sensitive: false, is_active: true, metadata: {}, translations: { en: { label: 'Dating mixer' } } },
        { id: 'c2', kind: 'event_category', key: 'retired', parent_id: null, position: 1, is_sensitive: false, is_active: false, metadata: {}, translations: { en: { label: 'Retired' } } },
      ],
      'GET /admin/taxonomy/interests': () => [{ id: interestId, key: 'board_games', category_id: 'x', icon: null, position: 0, is_active: true, translations: { en: { label: 'Board games' } } }],
      'GET /admin/geo/cities': () => ({ items: [{ id: cityId, country_code: 'FR', name: 'Paris', admin_region: 'Île-de-France', latitude: 48.8, longitude: 2.3, timezone: 'Europe/Paris', population: null, is_active: true }], nextCursor: null }),
      'POST /admin/events': () => json201({ id: 'e1' }),
    }, [...MANAGER, 'taxonomy.manage', 'geo.manage']);
    await screen.findByText(t('events.empty'));
    await user.click(screen.getByRole('button', { name: t('events.create') }));
    const d = screen.getByRole('dialog');

    // Invalid first: nothing is sent.
    await user.click(within(d).getByRole('button', { name: t('events.form.review') }));
    expect(within(d).getAllByText(t('validation.required')).length).toBeGreaterThan(0);
    expect(writes(calls)).toHaveLength(0);

    await user.type(field(t('events.form.eventTitle')), 'Speed dating night');
    await user.type(field(t('events.form.description')), 'Ten short dates and a welcome drink.');
    const category = await within(d).findByLabelText(new RegExp(`^${t('events.form.category')}`));
    expect(within(category).queryByRole('option', { name: 'Retired' })).toBeNull();
    await user.selectOptions(category, 'dating_mixer');
    setDateTime(t('events.form.startsAt'), '2026-12-01T19:00');
    setDateTime(t('events.form.endsAt'), '2026-12-01T22:00');
    await user.clear(field(t('events.form.timezone')));
    await user.type(field(t('events.form.timezone')), 'Europe/Paris');
    await user.type(within(d).getByLabelText(t('events.form.citySearch')), 'par');
    await user.click(within(d).getByRole('button', { name: t('events.form.searchCities') }));
    await user.selectOptions(await within(d).findByLabelText(new RegExp(`^${t('events.form.city')}( \\*)?$`)), cityId);
    await user.type(within(d).getByLabelText(t('events.form.venueName')), 'Le Bar');
    await user.type(within(d).getByLabelText(t('events.form.capacity')), '20');
    await user.click(await within(d).findByLabelText('Board games'));
    await user.type(within(d).getByLabelText(t('events.form.priceMinor')), '1500');
    await user.click(within(d).getByRole('button', { name: t('events.form.review') }));
    expect(within(d).getByText(t('events.form.currencyRequired'))).toBeInTheDocument();
    await user.type(within(d).getByLabelText(t('events.form.currency')), 'eur');
    await user.click(within(d).getByRole('button', { name: t('events.form.review') }));

    const confirm = screen.getByRole('dialog', { name: t('events.form.confirmTitle', { title: 'Speed dating night' }) });
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('events.form.publish') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({
      title: 'Speed dating night', description: 'Ten short dates and a welcome drink.', categoryKey: 'dating_mixer', cityId, venueName: 'Le Bar', isOnline: false,
      startsAt: new Date('2026-12-01T19:00').toISOString(), endsAt: new Date('2026-12-01T22:00').toISOString(), timezone: 'Europe/Paris', capacity: 20,
      interestIds: [interestId], preEventMatching: false, chatEnabled: true, visibility: 'public', priceMinor: 1500, currency: 'EUR',
    });
    expect(await screen.findByText(t('events.form.created', { title: 'Speed dating night' }))).toBeInTheDocument();
  });

  it('falls back to typed identifiers without taxonomy/geo access and checks the schedule order', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<EventsPage />, { 'GET /admin/events': () => page([]) }, [...MANAGER]);
    await screen.findByText(t('events.empty'));
    await user.click(screen.getByRole('button', { name: t('events.create') }));
    const d = screen.getByRole('dialog');
    expect(calls.some((c) => c.path.startsWith('/admin/taxonomy') || c.path.startsWith('/admin/geo'))).toBe(false);
    await user.type(field(t('events.form.eventTitle')), 'Picnic');
    await user.type(field(t('events.form.description')), 'A picnic in the park for everyone.');
    await user.type(field(t('events.form.category')), 'outdoors');
    await user.type(field(t('events.form.cityId')), 'not-a-uuid');
    setDateTime(t('events.form.startsAt'), '2026-12-01T19:00');
    setDateTime(t('events.form.endsAt'), '2026-12-01T18:00');
    await user.click(within(d).getByRole('button', { name: t('events.form.review') }));
    expect(within(d).getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    expect(within(d).getByText(t('validation.invalid'))).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(writes(calls)).toHaveLength(0);
  });
});

function json201(body: unknown) {
  return new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

import type { Permission } from '@amora/shared';
import type { CaseDetail, CaseRow } from '@/lib/api/modules/safety';
import { ALL_PERMISSIONS, type RecordedCall } from '@/test/utils';

/** Test fixtures shaped like the API's responses (safety-admin.controller.ts). */
export const CASE_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const ACTION_ID = '33333333-3333-4333-8333-333333333333';
export const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
export const OTHER_ADMIN = '55555555-5555-4555-8555-555555555555';

export const without = (...perms: Permission[]) => ALL_PERMISSIONS.filter((p) => !perms.includes(p));

export const caseRow = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: CASE_ID, subject_user_id: USER_ID, display_name: 'Sam', subject_status: 'active', country_code: 'DE', category: 'scam', severity: 'high', priority_score: '30.000',
  status: 'open', source: 'user_report', assigned_to: null, sla_due_at: '2026-10-08T12:00:00Z', opened_at: '2026-10-08T08:00:00Z', resolved_at: null, report_count: 2, sla_breached: false,
  ...over,
});

export const caseDetail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  id: CASE_ID, subject_user_id: USER_ID, category: 'scam', severity: 'high', priority_score: '30.000', status: 'open', source: 'user_report', assigned_to: null, assigned_at: null,
  sla_due_at: '2099-10-08T12:00:00Z', resolution_key: null, opened_at: '2026-10-08T08:00:00Z', resolved_at: null, updated_at: '2026-10-08T08:00:00Z',
  profile: { display_name: 'Sam', bio: 'Hello there', verification_level: 'none', status: 'active', created_at: '2026-01-01T00:00:00Z', country_code: 'DE' },
  reports: [{ id: 'r1', reporter_id: 'rep-1', target_type: 'message', target_id: 'msg-1', reason: 'scam', details: 'Asked me for money', created_at: '2026-10-08T08:00:00Z' }],
  notes: [{ id: 'n1', body: 'First look done', created_at: '2026-10-08T09:00:00Z', author: 'Ada' }],
  actions: [
    { id: ACTION_ID, case_id: CASE_ID, subject_user_id: USER_ID, action: 'restrict', content_type: null, content_id: null, params: { durationHours: null, restrictionKinds: ['no_messaging'], note: null }, reason_key: 'spam', actor_type: 'admin', actor_id: OTHER_ADMIN, created_at: '2026-10-08T09:30:00Z', reversed_at: null, reversed_by: null, reversal_action_id: null },
    { id: 'old-ban', case_id: null, subject_user_id: USER_ID, action: 'ban', content_type: null, content_id: null, params: null, reason_key: 'fraud', actor_type: 'admin', actor_id: OTHER_ADMIN, created_at: '2026-09-01T09:30:00Z', reversed_at: null, reversed_by: null, reversal_action_id: null },
  ],
  safetyEvents: [{ id: 'e1', signal: 'scam', source: 'text_moderation', score: 0.7, ref_type: 'message', ref_id: null, details: {}, created_at: '2026-10-07T00:00:00Z' }],
  priorCases: [],
  appeals: [],
  evidence: [
    { id: 'ev1', case_id: CASE_ID, kind: 'message', ref_id: 'msg-1', snapshot: { body: 'Send me 500 euros', kind: 'text', sentAt: '2026-10-08T07:00:00Z', senderId: USER_ID }, storage_key: null, captured_at: '2026-10-08T08:00:00Z', url: null },
    { id: 'ev2', case_id: CASE_ID, kind: 'media', ref_id: MEDIA_ID, snapshot: { storageKey: 'k' }, storage_key: null, captured_at: '2026-10-08T08:00:00Z', url: 'https://cdn.test/m.jpg' },
  ],
  ...over,
});

/** Mutations made by the page under test (excludes the sign-in POST). */
export const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/admin/auth/'));

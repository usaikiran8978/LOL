import type { blockCreate, relationshipControl, reportCreate, safetyLocationPing, safetySessionStart, safetySos, trustedContactCreate, verificationEvidenceUpload } from '@amora/shared';
import type { z } from 'zod';
import { client } from './index';
import type { Term } from './types';

type In<T extends z.ZodType> = z.input<T>;

// Shapes mirror apps/api/src/modules/safety/{safety,verification}.service.ts and dates/date-safety.service.ts.

export interface ReportResult {
  reportId: string;
  blocked: boolean;
}

export interface BlockedUser {
  userId: string;
  displayName: string | null;
  blockedAt: string;
}

export type VerificationKind = 'selfie' | 'identity';
export type VerificationStatus = 'pending' | 'processing' | 'needs_review' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export interface VerificationState {
  level: 'none' | 'selfie' | 'identity';
  history: Array<{
    id: string;
    kind: VerificationKind;
    status: VerificationStatus;
    poseChallenge: string | null;
    rejectionReasonKey: string | null;
    submittedAt: string;
    decidedAt: string | null;
    expiresAt: string | null;
  }>;
}
export interface VerificationStarted {
  requestId: string;
  kind: VerificationKind;
  poseChallenge: string | null;
  status: 'pending';
}
export interface EvidenceTicket {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface TrustedContact {
  id: string;
  name: string;
  relationship: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  confirmed: boolean;
}

export type SafetySessionStatus = 'scheduled' | 'active' | 'checked_in' | 'checked_out' | 'overdue' | 'escalated' | 'sos' | 'ended' | 'cancelled';
export interface SafetySession {
  id: string;
  status: SafetySessionStatus;
  datePlanId: string | null;
  trustedContactId: string | null;
  startsAt: string;
  checkInDueAt: string;
  graceMinutes: number;
  shareLiveLocation: boolean;
  checkedInAt: string | null;
  emergencyNumber: string | null;
  /** Only on start, and only when a trusted contact was chosen. */
  shareLink?: string | null;
}

export const OPEN_SESSION_STATUSES: readonly SafetySessionStatus[] = ['scheduled', 'active', 'checked_in', 'overdue', 'escalated', 'sos'];

export const safetyApi = {
  reportReasons: (locale: string) => client.get<Term[]>('/catalog/report-reasons', { query: { locale }, auth: 'none' }),
  report: (b: In<typeof reportCreate>) => client.post<ReportResult>('/reports', b),
  blocks: () => client.get<BlockedUser[]>('/blocks'),
  block: (b: In<typeof blockCreate>) => client.post<void>('/blocks', b),
  unblock: (userId: string) => client.delete(`/blocks/${encodeURIComponent(userId)}`),
  setControl: (b: In<typeof relationshipControl>) => client.put<void>('/relationship-controls', b),
};

export const verificationApi = {
  status: () => client.get<VerificationState>('/verification'),
  start: (kind: VerificationKind) => client.post<VerificationStarted>('/verification', { kind }),
  evidence: (requestId: string, b: In<typeof verificationEvidenceUpload>) => client.post<EvidenceTicket>(`/verification/${encodeURIComponent(requestId)}/evidence`, b),
  submit: (requestId: string) => client.post<VerificationState>(`/verification/${encodeURIComponent(requestId)}/submit`),
};

export const dateSafetyApi = {
  contacts: () => client.get<TrustedContact[]>('/dates/safety/contacts'),
  addContact: (b: In<typeof trustedContactCreate>) => client.post<TrustedContact[]>('/dates/safety/contacts', b),
  removeContact: (id: string) => client.delete(`/dates/safety/contacts/${encodeURIComponent(id)}`),
  /** Re-sends an unconfirmed contact's invite (429 RATE_LIMITED with `retryAfterMin`; 409 CONFLICT once confirmed). */
  resendContact: (id: string) => client.post<TrustedContact[]>(`/dates/safety/contacts/${encodeURIComponent(id)}/resend`),
  start: (b: In<typeof safetySessionStart>) => client.post<SafetySession>('/dates/safety/sessions', b),
  /** The member's open session, if any (restores it after an app restart or on another device). */
  active: () => client.get<{ session: SafetySession | null }>('/dates/safety/sessions/active'),
  session: (id: string) => client.get<SafetySession>(`/dates/safety/sessions/${encodeURIComponent(id)}`),
  checkIn: (id: string, extendMin?: number) => client.post<SafetySession>(`/dates/safety/sessions/${encodeURIComponent(id)}/check-in`, extendMin ? { extendMin } : {}),
  checkOut: (id: string) => client.post<SafetySession>(`/dates/safety/sessions/${encodeURIComponent(id)}/check-out`, {}),
  ping: (id: string, b: In<typeof safetyLocationPing>) => client.post<void>(`/dates/safety/sessions/${encodeURIComponent(id)}/location`, b),
  sos: (id: string, b: In<typeof safetySos>) => client.post<SafetySession>(`/dates/safety/sessions/${encodeURIComponent(id)}/sos`, b),
};

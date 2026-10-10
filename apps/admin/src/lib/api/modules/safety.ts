import type { adminAppealDecision, adminCaseAction, adminCaseCreate, adminCaseNote, adminCaseUpdate, adminMediaReview, adminVerificationDecision, Page } from '@amora/shared';
import { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/safety/safety-admin.controller.ts (rows are returned as database
 * columns, snake_case). `@amora/shared` only defines the request contracts.
 */

type In<T extends z.ZodType> = z.input<T>;
const enc = encodeURIComponent;

export const CASE_STATUSES = ['open', 'in_review', 'escalated', 'actioned', 'dismissed', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CASE_CATEGORIES = [
  'harassment', 'scam', 'fake_profile', 'spam', 'inappropriate_content', 'underage', 'violence', 'hate', 'self_harm', 'offline_safety', 'impersonation', 'other',
] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];
export type CaseSource = 'user_report' | 'automated' | 'admin' | 'appeal';

export interface CaseRow {
  id: string;
  subject_user_id: string | null;
  display_name: string | null;
  subject_status: string | null;
  country_code: string | null;
  category: CaseCategory;
  severity: Severity;
  /** Postgres numeric — serialised as a string by the driver. */
  priority_score: string | number;
  status: CaseStatus;
  source: CaseSource;
  assigned_to: string | null;
  sla_due_at: string;
  opened_at: string;
  resolved_at: string | null;
  report_count: number;
  sla_breached: boolean;
}

export interface CaseQuery {
  status?: CaseStatus;
  severity?: Severity;
  category?: string;
  assignedTo?: string;
  subjectUserId?: string;
  cursor?: string;
  limit?: number;
}

export interface CaseReport {
  id: string;
  reporter_id: string | null;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  details: string | null;
  created_at: string;
}

export interface CaseEvidence {
  id: string;
  case_id: string;
  kind: 'message' | 'media' | 'profile_snapshot' | 'prompt' | 'event' | 'note_attachment';
  ref_id: string | null;
  /** `{ redacted: true }` for message evidence when the admin lacks `moderation.view_messages`. */
  snapshot: unknown;
  storage_key: string | null;
  captured_at: string;
  /** Short-lived signed download URL for stored media evidence. */
  url: string | null;
}

export interface CaseNote {
  id: string;
  body: string;
  created_at: string;
  author: string | null;
}

export type ModerationActionType =
  | 'warn' | 'restrict' | 'suspend' | 'ban' | 'remove_content' | 'restore_content' | 'escalate' | 'unban' | 'unsuspend' | 'lift_restriction' | 'verify' | 'unverify' | 'force_logout';

export interface ModerationActionRow {
  id: string;
  case_id: string | null;
  subject_user_id: string | null;
  action: ModerationActionType;
  content_type: string | null;
  content_id: string | null;
  params: { durationHours?: number | null; restrictionKinds?: string[] | null; note?: string | null } | null;
  reason_key: string;
  actor_type: 'admin' | 'system';
  actor_id: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_action_id: string | null;
}

export interface SafetyEventRow {
  id: string;
  signal: string;
  source: string;
  score: number;
  ref_type: string | null;
  ref_id: string | null;
  details: unknown;
  created_at: string;
}

export interface PriorCase {
  id: string;
  category: CaseCategory;
  severity: Severity;
  status: CaseStatus;
  opened_at: string;
}

export interface CaseAppeal {
  id: string;
  status: AppealStatus;
  statement: string;
  created_at: string;
  action: ModerationActionType;
}

export interface CaseDetail {
  id: string;
  subject_user_id: string | null;
  category: CaseCategory;
  severity: Severity;
  priority_score: string | number;
  status: CaseStatus;
  source: CaseSource;
  assigned_to: string | null;
  assigned_at: string | null;
  sla_due_at: string;
  resolution_key: string | null;
  opened_at: string;
  resolved_at: string | null;
  updated_at: string;
  profile: { display_name: string | null; bio: string | null; verification_level: string | null; status: string; created_at: string; country_code: string | null } | null | undefined;
  reports: CaseReport[];
  notes: CaseNote[];
  actions: ModerationActionRow[];
  safetyEvents: SafetyEventRow[];
  priorCases: PriorCase[];
  appeals: CaseAppeal[];
  evidence: CaseEvidence[];
}

export const APPEAL_STATUSES = ['submitted', 'in_review', 'upheld', 'overturned', 'partially_overturned'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export interface AppealRow {
  id: string;
  user_id: string;
  statement: string;
  status: AppealStatus;
  created_at: string;
  action: ModerationActionType;
  reason_key: string;
  case_id: string | null;
  /** Who took the appealed action; that admin may not decide the appeal (different-reviewer rule). */
  actor_id: string | null;
}

export const REPORT_STATUSES = ['received', 'triaged', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Row of `GET admin/moderation/reports` (every report, newest first). */
export interface ReportRow {
  id: string;
  /** Null unless the admin holds `users.view_pii`. */
  reporter_id: string | null;
  reported_user_id: string | null;
  target_type: string;
  target_id: string | null;
  reason_key: string | null;
  details: string | null;
  case_id: string | null;
  status: ReportStatus;
  created_at: string;
  country_code: string | null;
}

export interface ReportQuery {
  status?: ReportStatus;
  reasonKey?: string;
  reportedUserId?: string;
  cursor?: string;
  limit?: number;
}

/** Row of `GET admin/moderation/risk-scores` (score desc). */
export interface RiskScoreRow {
  user_id: string;
  display_name: string | null;
  status: string;
  country_code: string | null;
  /** Postgres numeric — may arrive as a string. */
  score: number | string;
  components: { signals?: Record<string, number>; reporters?: number } | null;
  computed_at: string;
}

export const RULE_TYPES = ['keyword', 'regex', 'classifier_threshold', 'velocity', 'auto_action', 'sla'] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export const RULE_SCOPES = ['message', 'profile_text', 'media', 'account', 'event', 'ai_output'] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export interface ModerationRule {
  id: string;
  key: string;
  rule_type: RuleType;
  scope: RuleScope;
  config: Record<string, unknown>;
  locale: string | null;
  is_active: boolean;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Mirrors the inline body schema of `PUT admin/moderation/rules/:key` (not exported from @amora/shared).
 * The key itself must match /^[a-z0-9_]{2,64}$/ (checked by the controller).
 */
export const ruleUpsertSchema = z.object({
  ruleType: z.enum(RULE_TYPES),
  scope: z.enum(RULE_SCOPES),
  config: z.record(z.string(), z.unknown()),
  locale: z.string().max(10).nullable().default(null),
  isActive: z.boolean().default(true),
});
export const RULE_KEY_RE = /^[a-z0-9_]{2,64}$/;

/** Mirrors the inline body schema of `POST admin/moderation/actions/:id/reverse` (note is optional in the API). */
export const reverseSchema = z.object({ note: z.string().max(3000).optional() });

export interface VerificationQueueRow {
  id: string;
  user_id: string;
  display_name: string | null;
  kind: 'selfie' | 'identity';
  status: VerificationStatus;
  provider: string;
  pose_challenge: string | null;
  submitted_at: string;
}

export type VerificationStatus = 'pending' | 'processing' | 'needs_review' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface VerificationDetail {
  id: string;
  user_id: string;
  kind: 'selfie' | 'identity';
  status: VerificationStatus;
  provider: string;
  provider_ref: string | null;
  pose_challenge: string | null;
  evidence_keys: string[];
  liveness_score: number | null;
  face_match_score: number | null;
  document_country: string | null;
  rejection_reason_key: string | null;
  reviewer_id: string | null;
  submitted_at: string;
  decided_at: string | null;
  expires_at: string | null;
  evidence_purged_at: string | null;
  /** Signed URLs, only for admins with `verification.view_evidence` (null otherwise). */
  evidence: string[] | null;
  profilePhotos: Array<{ id: string; url: string }>;
}

export interface ReviewMedia {
  id: string;
  user_id: string;
  kind: 'photo' | 'video' | 'voice';
  moderation_status: 'pending' | 'needs_review';
  created_at: string;
  url: string;
}

export interface ReviewPrompt {
  id: string;
  user_id: string;
  answer: string;
  created_at: string;
}

export interface ReviewProfile {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  updated_at: string;
}

export interface ProfileReviewQueue {
  media: ReviewMedia[];
  prompts: ReviewPrompt[];
  profiles: ReviewProfile[];
}

/** `safety` block of GET /admin/users/:id (present only with `users.view_safety_history`). */
export interface UserRiskScore {
  score: number;
  components: { signals?: Record<string, number>; reporters?: number } | null;
  computed_at: string;
}

/** Typed wrappers for the safety admin endpoints (moderation, appeals, rules, verification, profile review). */
export function safetyApi(c: ApiClient) {
  return {
    cases: (q: CaseQuery) => c.get<Page<CaseRow>>('/admin/moderation/cases', { ...q }),
    case: (id: string) => c.get<CaseDetail>(`/admin/moderation/cases/${enc(id)}`),
    createCase: (body: In<typeof adminCaseCreate>) => c.post<{ caseId: string }>('/admin/moderation/cases', body),
    updateCase: (id: string, body: In<typeof adminCaseUpdate>) => c.put<unknown>(`/admin/moderation/cases/${enc(id)}`, body),
    addNote: (id: string, body: In<typeof adminCaseNote>) => c.post<unknown>(`/admin/moderation/cases/${enc(id)}/notes`, body),
    act: (id: string, body: In<typeof adminCaseAction>) => c.post<{ actionId: string }>(`/admin/moderation/cases/${enc(id)}/actions`, body),
    reverse: (actionId: string, body: In<typeof reverseSchema>) => c.post<{ reversalActionId: string | null }>(`/admin/moderation/actions/${enc(actionId)}/reverse`, body),
    appeals: (q: { status?: string; cursor?: string; limit?: number }) => c.get<Page<AppealRow>>('/admin/moderation/appeals', { ...q }),
    reports: (q: ReportQuery) => c.get<Page<ReportRow>>('/admin/moderation/reports', { ...q }),
    riskScores: (q: { minScore?: number; cursor?: string; limit?: number }) => c.get<Page<RiskScoreRow>>('/admin/moderation/risk-scores', { ...q }),
    decideAppeal: (id: string, body: In<typeof adminAppealDecision>) => c.post<{ status: string }>(`/admin/moderation/appeals/${enc(id)}/decision`, body),
    rules: () => c.get<ModerationRule[]>('/admin/moderation/rules'),
    upsertRule: (key: string, body: In<typeof ruleUpsertSchema>) => c.put<ModerationRule>(`/admin/moderation/rules/${enc(key)}`, body),
    verificationQueue: (q: { cursor?: string; limit?: number }) => c.get<Page<VerificationQueueRow>>('/admin/verification/queue', { ...q }),
    verification: (id: string) => c.get<VerificationDetail>(`/admin/verification/${enc(id)}`),
    decideVerification: (id: string, body: In<typeof adminVerificationDecision>) => c.post<void>(`/admin/verification/${enc(id)}/decision`, body),
    reviewQueue: (q: { limit?: number }) => c.get<ProfileReviewQueue>('/admin/profile-review/queue', { ...q }),
    reviewMedia: (id: string, body: In<typeof adminMediaReview>) => c.post<void>(`/admin/profile-review/media/${enc(id)}`, body),
    reviewPrompt: (id: string, body: In<typeof adminMediaReview>) => c.post<void>(`/admin/profile-review/prompts/${enc(id)}`, body),
    reviewProfile: (userId: string, body: In<typeof adminMediaReview>) => c.post<void>(`/admin/profile-review/profiles/${enc(userId)}`, body),
    /** One user's score is part of the user detail (users.view + users.view_safety_history); only that block is typed. */
    userSafety: (userId: string) => c.get<{ safety: { riskScore: UserRiskScore | null } | null }>(`/admin/users/${enc(userId)}`),
  };
}

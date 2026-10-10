import { z } from 'zod';
import { queryBool, uuid } from './common';

export const REPORT_TARGETS = ['user', 'profile', 'media', 'message', 'prompt', 'event', 'date'] as const;

export const reportCreate = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: uuid,
  reasonKey: z.string().regex(/^[a-z_]{2,50}$/),
  details: z.string().trim().max(2000).optional(),
  /** Message ids the reporter wants attached as evidence (must be from a shared conversation). */
  messageIds: z.array(uuid).max(20).default([]),
  alsoBlock: z.boolean().default(false),
});

export const blockCreate = z.object({ userId: uuid, reasonKey: z.string().max(50).optional() });
export const relationshipControl = z.object({ userId: uuid, control: z.enum(['mute', 'restrict']), enabled: z.boolean() });

export const verificationStart = z.object({ kind: z.enum(['selfie', 'identity']) });
export const verificationEvidenceUpload = z.object({ mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'video/mp4']), byteSize: z.number().int().positive().max(25 * 1024 * 1024) });
export const appealCreate = z.object({ actionId: uuid, statement: z.string().trim().min(10).max(3000) });

// ------------------------------------------------------------------ admin

export const MODERATION_ACTIONS = ['warn', 'restrict', 'suspend', 'ban', 'remove_content', 'restore_content', 'escalate', 'unban', 'unsuspend', 'lift_restriction'] as const;
export const RESTRICTION_KINDS = ['no_messaging', 'no_discovery', 'no_likes', 'no_media_upload', 'no_events', 'shadow_limited', 'review_required'] as const;

export const adminCaseQuery = z.object({
  status: z.enum(['open', 'in_review', 'escalated', 'actioned', 'dismissed', 'closed']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  category: z.string().max(40).optional(),
  assignedTo: z.union([uuid, z.literal('me'), z.literal('unassigned')]).optional(),
  subjectUserId: uuid.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminCaseAction = z
  .object({
    action: z.enum(MODERATION_ACTIONS),
    reasonKey: z.string().regex(/^[a-z_]{2,60}$/),
    note: z.string().max(5000).optional(),
    durationHours: z.number().int().min(1).max(24 * 365).optional(),       // suspend / restrict
    restrictionKinds: z.array(z.enum(RESTRICTION_KINDS)).max(7).optional(), // restrict
    contentType: z.enum(['media', 'message', 'prompt', 'bio', 'event']).optional(),
    contentId: uuid.optional(),
    restrictionId: uuid.optional(),                                          // lift_restriction
    notifyUser: z.boolean().default(true),
  })
  .refine((a) => a.action !== 'restrict' || (a.restrictionKinds?.length ?? 0) > 0, { message: 'restrictionKinds required', path: ['restrictionKinds'] })
  .refine((a) => !['remove_content', 'restore_content'].includes(a.action) || (a.contentType && (a.contentType === 'bio' || a.contentId)), { message: 'contentType/contentId required', path: ['contentId'] })
  .refine((a) => a.action !== 'suspend' || !!a.durationHours, { message: 'durationHours required', path: ['durationHours'] });

export const adminCaseUpdate = z.object({
  status: z.enum(['open', 'in_review', 'escalated', 'dismissed', 'closed']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignTo: z.union([uuid, z.literal('me'), z.null()]).optional(),
  resolutionKey: z.string().max(60).optional(),
});
export const adminCaseNote = z.object({ body: z.string().trim().min(1).max(5000) });
export const adminCaseCreate = z.object({
  subjectUserId: uuid,
  category: z.enum(['harassment', 'scam', 'fake_profile', 'spam', 'inappropriate_content', 'underage', 'violence', 'hate', 'self_harm', 'offline_safety', 'impersonation', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  note: z.string().max(5000).optional(),
});
export const adminAppealDecision = z.object({ decision: z.enum(['upheld', 'overturned']), note: z.string().max(3000).optional() });
export const adminVerificationDecision = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReasonKey: z.string().max(60).optional() });
export const adminMediaReview = z.object({ decision: z.enum(['approved', 'rejected']), reasonKey: z.string().max(60).optional() });

export const adminUserSearch = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'active', 'restricted', 'suspended', 'banned', 'deactivated', 'deleted']).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  verified: queryBool.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const adminUserAction = z.object({
  action: z.enum(['suspend', 'unsuspend', 'ban', 'unban', 'restore', 'force_logout', 'reset_lockout', 'verify', 'unverify']),
  reasonKey: z.string().regex(/^[a-z_]{2,60}$/),
  note: z.string().max(5000).optional(),
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
});

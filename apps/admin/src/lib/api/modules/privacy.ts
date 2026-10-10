import type { Page } from '@amora/shared';
import { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Request schemas mirror the inline zod schemas of apps/api/src/modules/privacy/privacy.controller.ts
 * (AdminPrivacyController) — they are not exported from @amora/shared. Response shapes mirror the rows it selects.
 */

export const DSAR_KINDS = ['export', 'delete', 'rectify', 'restrict_processing', 'object'] as const;
export const DSAR_STATUSES = ['received', 'verifying', 'in_progress', 'completed', 'rejected', 'cancelled'] as const;
export const RETENTION_ACTIONS = ['delete', 'anonymize'] as const;

export const dsarCreateSchema = z.object({
  userId: z.uuid(),
  kind: z.enum(DSAR_KINDS),
  notes: z.string().max(2000).optional(),
});

export const retentionUpdateSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650),
  action: z.enum(RETENTION_ACTIONS),
});

export type DsarKind = (typeof DSAR_KINDS)[number];
export type DsarStatus = (typeof DSAR_STATUSES)[number];
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

export interface DsarRequest {
  id: string;
  /** Null once the user row is gone (FK ON DELETE SET NULL); such requests cannot be executed. */
  user_id: string | null;
  subject_email: string | null;
  kind: DsarKind;
  status: DsarStatus;
  regime: string | null;
  due_at: string;
  created_at: string;
  completed_at: string | null;
  handled_by: string | null;
  notes: string | null;
}

export interface RetentionPolicy {
  entity: string;
  retention_days: number;
  action: RetentionAction;
  country_overrides: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
}

const enc = encodeURIComponent;

/** Typed wrappers for the privacy admin endpoints. */
export function privacyApi(c: ApiClient) {
  return {
    /** Without a status the API returns the open queue (received / verifying / in progress), ordered by due date. */
    requests: (q: { status?: DsarStatus; cursor?: string; limit?: number }) => c.get<Page<DsarRequest>>('/admin/privacy/requests', { ...q }),
    createRequest: (body: z.input<typeof dsarCreateSchema>) => c.post<{ id: string }>('/admin/privacy/requests', body),
    executeRequest: (id: string) => c.post<void>(`/admin/privacy/requests/${enc(id)}/execute`),
    retention: () => c.get<RetentionPolicy[]>('/admin/privacy/retention'),
    updateRetention: (entity: string, body: z.input<typeof retentionUpdateSchema>) => c.put<void>(`/admin/privacy/retention/${enc(entity)}`, body),
  };
}

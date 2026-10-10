import { client } from './index';

// Shapes mirror apps/api/src/modules/privacy/privacy.service.ts.

export interface PrivacyRequest {
  id: string;
  kind: 'export' | 'delete' | 'rectify' | 'restrict_processing' | 'object';
  status: 'received' | 'verifying' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
  requestedAt: string;
  completedAt: string | null;
  /** Short-lived signed URL while a completed export is still available. */
  downloadUrl: string | null;
  /** Purge date of a pending account deletion. */
  scheduledFor: string | null;
}

export const DELETION_GRACE_DAYS = 14;

export const privacyRequestsApi = {
  list: () => client.get<PrivacyRequest[]>('/users/me/privacy/requests'),
  requestExport: () => client.post<{ requestId: string; status: string }>('/users/me/privacy/export'),
  /** Revokes every session on success; the caller must sign out locally. */
  requestDeletion: (password?: string) => client.post<{ status: 'scheduled'; purgeAt: string }>('/users/me/privacy/delete-account', password ? { password } : {}),
  cancelDeletion: () => client.delete('/users/me/privacy/delete-account'),
};

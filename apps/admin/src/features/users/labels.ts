import { adminUserSearch } from '@amora/shared';
import type { BadgeTone } from '@/components/ui/Badge';
import { t, tDynamic } from '@/i18n';
import type { UserStatus } from '@/lib/api/modules/users';

export const USER_STATUSES = adminUserSearch.shape.status.unwrap().options;

export const statusLabel = (s: string) => tDynamic(`users.statuses.${s}`, s);

export function statusTone(s: UserStatus | string): BadgeTone {
  switch (s) {
    case 'active':
      return 'success';
    case 'pending':
      return 'info';
    case 'restricted':
    case 'deactivated':
      return 'warning';
    case 'suspended':
    case 'banned':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const verificationLabel = (v: string | null | undefined) => (v ? tDynamic(`users.verificationLevels.${v}`, v) : t('users.verificationLevels.none'));

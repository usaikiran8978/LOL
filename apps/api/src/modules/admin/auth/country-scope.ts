import type { Database } from '../../../common/db/database';
import { AppError } from '../../../common/errors/app-error';
import type { AdminContext } from './admin-auth.service';

/**
 * Country-scoped admins (ABAC) may only see or act on users from their countries. Out-of-scope users are reported as
 * NOT_FOUND so their existence is not disclosed. Unscoped admins (countryScope = null) pass.
 */
export async function assertUserInScope(db: Database, admin: AdminContext, userId: string | null | undefined): Promise<void> {
  if (!admin.countryScope) return;
  if (!userId) throw new AppError('NOT_FOUND');
  const u = await db.selectFrom('users').select('country_code').where('id', '=', userId).executeTakeFirst();
  if (!u?.country_code || !admin.countryScope.includes(u.country_code)) throw new AppError('NOT_FOUND');
}

import type { Request } from 'express';
import type { AuditService } from '../../../common/audit/audit.service';
import type { Database, Tx } from '../../../common/db/database';
import { AppError } from '../../../common/errors/app-error';
import { clientContext } from '../../../common/http/request-context';
import type { AdminContext } from '../auth/admin-auth.service';

/** Shared plumbing for admin writes: run in a transaction and append an audit record with before/after state. */
export abstract class AuditedController {
  constructor(
    protected readonly db: Database,
    protected readonly audit: AuditService,
  ) {}

  protected async write<T>(admin: AdminContext, req: Request, action: string, target: { type: string; id: string }, before: unknown, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const after = await fn(trx);
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action, targetType: target.type, targetId: target.id, before, after, client: clientContext(req) }, trx);
      return after;
    });
  }
}

export function uniqueViolation(err: unknown): never {
  if ((err as { code?: string }).code === '23505') throw new AppError('CONFLICT', 'Key already exists');
  throw err;
}

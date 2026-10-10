import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { adminAuditQuery, type Page } from '@amora/shared';
import { z } from 'zod';
import { DATABASE, type Database } from '../../../common/db/database';
import { decodeCursor, encodeCursor } from '../../../common/http/cursor';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { AdminGuard, RequirePermissions } from '../auth/admin.guard';

const query = adminAuditQuery;

/** BRD §19 "Audit logs" — read-only, newest first, keyset-paginated. */
@ApiTags('admin-audit')
@Controller('admin/audit-logs')
@UseGuards(AdminGuard)
export class AuditLogsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('audit.view')
  async list(@Query(new ZodPipe(query)) q: z.infer<typeof query>): Promise<Page<unknown>> {
    const cursor = decodeCursor<[string]>(q.cursor, 1);
    let qb = this.db
      .selectFrom('audit_logs')
      .select(['id', 'actor_type', 'actor_id', 'action', 'target_type', 'target_id', 'before_state', 'after_state', 'reason', 'ip', 'request_id', 'created_at'])
      .orderBy('id', 'desc')
      .limit(q.limit + 1);
    if (cursor) qb = qb.where('id', '<', cursor[0]);
    if (q.actorType) qb = qb.where('actor_type', '=', q.actorType);
    if (q.actorId) qb = qb.where('actor_id', '=', q.actorId);
    if (q.action) qb = qb.where('action', '=', q.action);
    if (q.targetType) qb = qb.where('target_type', '=', q.targetType);
    if (q.targetId) qb = qb.where('target_id', '=', q.targetId);
    if (q.from) qb = qb.where('created_at', '>=', new Date(q.from));
    if (q.to) qb = qb.where('created_at', '<', new Date(q.to));

    const rows = await qb.execute();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        actorType: r.actor_type,
        actorId: r.actor_id,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        before: r.before_state,
        after: r.after_state,
        reason: r.reason,
        ip: r.ip,
        requestId: r.request_id,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      nextCursor: rows.length > q.limit ? encodeCursor([page[page.length - 1]!.id]) : null,
    };
  }
}

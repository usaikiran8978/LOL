import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { ExperimentsService } from './experiments.service';
import { KPI_DEFINITIONS, MetricsService } from './metrics.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seriesQuery = z.object({ from: day, to: day, dimension: z.string().regex(/^[a-z]+(:[A-Za-z0-9_]+)?$/).default('all') });
const experimentInput = z.object({
  surface: z.enum(['matching', 'profile_layout', 'onboarding', 'questionnaire', 'paywall', 'discovery', 'ai', 'notifications', 'other']),
  hypothesis: z.string().max(2000).optional(),
  segmentKey: z.string().max(64).nullable().default(null),
  trafficPct: z.number().int().min(1).max(100),
  primaryMetric: z.string().regex(/^[a-z_]{2,64}$/),
  variants: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), allocation: z.number().int().min(1).max(100), isControl: z.boolean().default(false), config: z.record(z.string(), z.unknown()).default({}) })).min(2).max(6),
});

@ApiTags('admin-analytics')
@Controller('admin/analytics')
@UseGuards(AdminGuard)
export class AdminAnalyticsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly experiments: ExperimentsService,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** KPI dashboard (BRD §19/§21): live counters + daily series. */
  @Get('dashboard')
  @RequirePermissions('dashboard.view')
  dashboard(@Query(new ZodPipe(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }))) q: { days: number }) {
    return this.metrics.dashboard(q.days);
  }

  @Get('metrics/:metric')
  @RequirePermissions('analytics.view')
  series(@Param('metric') metric: string, @Query(new ZodPipe(seriesQuery)) q: z.infer<typeof seriesQuery>) {
    if (!(metric in KPI_DEFINITIONS)) throw new AppError('NOT_FOUND', 'Unknown metric');
    return this.metrics.series(metric, q.from, q.to, q.dimension);
  }

  @Get('export.csv')
  @RequirePermissions('analytics.export')
  async export(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Res() res: Response, @Query(new ZodPipe(z.object({ from: day, to: day }))) q: { from: string; to: string }) {
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'analytics.exported', after: q, client: clientContext(req) });
    const rows = await this.db.selectFrom('analytics_daily_metrics').select(['metric_date', 'metric', 'dimension', 'value']).where('metric_date', '>=', q.from).where('metric_date', '<=', q.to).orderBy('metric_date').orderBy('metric').execute();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="metrics_${q.from}_${q.to}.csv"`);
    res.send(['date,metric,dimension,value', ...rows.map((r) => `${r.metric_date},${r.metric},${r.dimension},${r.value}`)].join('\n'));
  }

  @Post('recompute/:day')
  @HttpCode(204)
  @RequirePermissions('analytics.export')
  async recompute(@Param('day', new ZodPipe(day)) d: string) {
    await this.metrics.compute(d);
  }

  // ---------------------------------------------------------------------------- experiments

  @Get('experiments')
  @RequirePermissions('analytics.view')
  async list() {
    const [e, v] = await Promise.all([this.db.selectFrom('experiments').selectAll().orderBy('created_at', 'desc').execute(), this.db.selectFrom('experiment_variants').selectAll().execute()]);
    return e.map((x) => ({ ...x, variants: v.filter((y) => y.experiment_id === x.id) }));
  }

  @Put('experiments/:key')
  @RequirePermissions('experiments.manage')
  upsert(@CurrentAdmin() a: AdminContext, @Param('key') key: string, @Body(new ZodPipe(experimentInput)) b: z.infer<typeof experimentInput>) {
    if (!/^[a-z0-9_.]{2,64}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'invalid key');
    return this.experiments.upsert(a.adminId, { key, ...b });
  }

  @Post('experiments/:key/:to')
  @HttpCode(204)
  @RequirePermissions('experiments.manage')
  async transition(@CurrentAdmin() a: AdminContext, @Param('key') key: string, @Param('to') to: string) {
    if (!['running', 'paused', 'completed', 'archived'].includes(to)) throw new AppError('NOT_FOUND');
    await this.experiments.transition(a.adminId, key, to as 'running');
  }

  @Get('experiments/:key/results')
  @RequirePermissions('analytics.view')
  results(@Param('key') key: string) {
    return this.experiments.results(key);
  }
}

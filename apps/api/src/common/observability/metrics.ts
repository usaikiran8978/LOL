import { Controller, Get, Headers, Inject, Injectable, type NestMiddleware, type OnModuleInit, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { sql } from 'kysely';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DATABASE, type Database } from '../db/database';
import { OUTBOX_MAX_ATTEMPTS } from '../outbox/outbox.service';
import { AppError } from '../errors/app-error';

/** One registry per app instance (tests create several apps in one process). */
@Injectable()
export class Metrics implements OnModuleInit {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route template',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly httpErrors = new Counter({ name: 'http_server_errors_total', help: '5xx responses', labelNames: ['route'] as const, registers: [this.registry] });

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
    const db = this.db;
    // Queue depths are read at scrape time so alerts work even when workers are stuck.
    new Gauge({
      name: 'outbox_pending_events', help: 'Undispatched outbox events (pending vs. dead-lettered after exhausting retries)', labelNames: ['state'] as const, registers: [this.registry],
      async collect() {
        const r = await sql<{ pending: number; stuck: number }>`
          SELECT count(*) FILTER (WHERE attempts < ${OUTBOX_MAX_ATTEMPTS})::int AS pending, count(*) FILTER (WHERE attempts >= ${OUTBOX_MAX_ATTEMPTS})::int AS stuck
          FROM outbox_events WHERE dispatched_at IS NULL`.execute(db);
        this.set({ state: 'pending' }, r.rows[0]?.pending ?? 0);
        this.set({ state: 'stuck' }, r.rows[0]?.stuck ?? 0);
      },
    });
    new Gauge({
      name: 'moderation_open_cases', help: 'Open moderation cases by severity', labelNames: ['severity'] as const, registers: [this.registry],
      async collect() {
        this.reset();
        const r = await sql<{ severity: string; n: number }>`SELECT severity::text, count(*)::int AS n FROM moderation_cases WHERE status IN ('open','in_review','escalated') GROUP BY 1`.execute(db);
        for (const row of r.rows) this.set({ severity: row.severity }, row.n);
      },
    });
  }
}

/** Records latency per route template (never the raw URL, which can carry ids and query PII) and writes access logs. */
@Injectable()
export class HttpObservabilityMiddleware implements NestMiddleware {
  constructor(private readonly metrics: Metrics, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const tpl = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : '';
      // Framework catch-all (404) routes would otherwise appear as a wildcard template.
      const route = tpl && !tpl.includes('*') ? tpl : 'unmatched';
      this.metrics.httpDuration.observe({ method: req.method, route, status: String(res.statusCode) }, seconds);
      if (res.statusCode >= 500) this.metrics.httpErrors.inc({ route });
      if (this.cfg.LOG_FORMAT === 'json') {
        process.stdout.write(`${JSON.stringify({
          level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', msg: 'http', time: new Date().toISOString(),
          requestId: req.requestId, method: req.method, route, status: res.statusCode, durationMs: Math.round(seconds * 1000),
        })}\n`);
      }
    });
    next();
  }
}

/** Prometheus scrape endpoint. Requires METRICS_TOKEN as a bearer token when set; without one it is disabled in production. */
@ApiExcludeController()
@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  constructor(private readonly metrics: Metrics, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Get()
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response): Promise<void> {
    const token = this.cfg.METRICS_TOKEN;
    if (!token && this.cfg.NODE_ENV === 'production') throw new AppError('NOT_FOUND');
    if (token) {
      const given = Buffer.from(auth?.startsWith('Bearer ') ? auth.slice(7) : '');
      const want = Buffer.from(token);
      if (given.length !== want.length || !timingSafeEqual(given, want)) throw new AppError('UNAUTHENTICATED');
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}

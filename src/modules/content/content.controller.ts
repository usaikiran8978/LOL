import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ANALYTICS_EVENTS, clientAnalyticsBatch, countryCode, SERVER_ONLY_ANALYTICS_EVENTS } from '@amora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { localeChain, pickTranslation } from '../../common/i18n/translations';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';

const KINDS = ['faq', 'help_article', 'safety_tip', 'safety_guide', 'announcement', 'page', 'onboarding_tip', 'paywall_copy'] as const;
const listQuery = z.object({ kind: z.enum(KINDS), country: countryCode.optional(), category: z.string().max(50).optional() });

/** FAQ, help, safety education, announcements (BRD §15, §19) — published, in-window, country-targeted, localized. */
@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private base(locale: string, country?: string) {
    const now = new Date();
    let qb = this.db
      .selectFrom('cms_entries as e')
      .innerJoin('cms_entry_translations as t', 't.entry_id', 'e.id')
      .select(['e.id', 'e.key', 'e.kind', 'e.category', 'e.position', 'e.publish_at', 't.locale', 't.title', 't.body_md'])
      .where('e.status', '=', 'published')
      .where('t.locale', 'in', localeChain(locale))
      .where((eb) => eb.or([eb('e.publish_at', 'is', null), eb('e.publish_at', '<=', now)]))
      .where((eb) => eb.or([eb('e.unpublish_at', 'is', null), eb('e.unpublish_at', '>', now)]));
    qb = country ? qb.where((eb) => eb.or([eb('e.country_codes', 'is', null), eb(eb.val(country), '=', eb.fn.any('e.country_codes'))])) : qb.where('e.country_codes', 'is', null);
    return qb;
  }

  private collapse(rows: Array<{ id: string; key: string; kind: string; category: string | null; locale: string; title: string; body_md: string; publish_at: Date | null }>, locale: string) {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(r.id, [...(groups.get(r.id) ?? []), r]);
    return [...groups.values()].map((g) => {
      const t = pickTranslation(g, locale)!;
      return { id: t.id, key: t.key, kind: t.kind, category: t.category, locale: t.locale, title: t.title, bodyMarkdown: t.body_md, publishedAt: t.publish_at ? new Date(t.publish_at).toISOString() : null };
    });
  }

  @Get()
  async list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>, @Req() req: Request) {
    const locale = requestLocale(req);
    let qb = this.base(locale, q.country).where('e.kind', '=', q.kind).orderBy('e.position');
    if (q.category) qb = qb.where('e.category', '=', q.category);
    return this.collapse(await qb.execute(), locale);
  }

  @Get(':key')
  async get(@Param('key') key: string, @Query('country') country: string | undefined, @Req() req: Request) {
    if (!/^[a-z0-9_.-]{1,100}$/.test(key)) throw new AppError('NOT_FOUND');
    const locale = requestLocale(req);
    const rows = await this.base(locale, country && /^[A-Z]{2}$/.test(country) ? country : undefined).where('e.key', '=', key).execute();
    const [entry] = this.collapse(rows, locale);
    if (!entry) throw new AppError('NOT_FOUND');
    return entry;
  }
}

const ALLOWED = new Set<string>(ANALYTICS_EVENTS);
const SERVER_ONLY = new Set<string>(SERVER_ONLY_ANALYTICS_EVENTS);

/** Client analytics ingestion (TECH §19). Allow-listed names, bounded properties, server timestamps clamped. */
@ApiTags('analytics')
@Controller('analytics')
@UseGuards(UserAuthGuard)
export class ClientAnalyticsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post('events')
  @HttpCode(202)
  async ingest(@CurrentUser() u: AuthContext, @Body(new ZodPipe(clientAnalyticsBatch)) body: z.infer<typeof clientAnalyticsBatch>) {
    // Product analytics from the client require consent (enforced here, not only in the app).
    const consent = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', u.userId).where('consent_type', '=', 'analytics').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (consent && !consent.granted) return { accepted: 0, rejected: body.events.length, reason: 'consent_withdrawn' };
    const now = Date.now();
    const accepted = body.events.filter((e) => ALLOWED.has(e.name) && !SERVER_ONLY.has(e.name) && Object.keys(e.properties).length <= 20);
    if (accepted.length) {
      const user = await this.db.selectFrom('users').select('country_code').where('id', '=', u.userId).executeTakeFirst();
      await this.db
        .insertInto('analytics_events')
        .values(
          accepted.map((e) => {
            const t = new Date(e.occurredAt).getTime();
            // Clamp client clocks: no future events, nothing older than 7 days (offline queues).
            const occurred = new Date(Math.min(now, Math.max(t, now - 7 * 86_400_000)));
            return { name: e.name, user_id: u.userId, session_id: u.sessionId, occurred_at: occurred, platform: body.platform, app_version: body.appVersion ?? null, country_code: user?.country_code ?? null, properties: JSON.stringify(e.properties) };
          }),
        )
        .execute();
    }
    return { accepted: accepted.length, rejected: body.events.length - accepted.length };
  }
}

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { DATABASE, type Database } from '../../common/db/database';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ModuleRef } from '@nestjs/core';
import { ExperimentsService } from '../analytics/experiments.service';
import { FlagsService } from './flags.service';
import { OptionalUserAuthGuard } from './optional-auth.guard';
import { SettingsService } from './settings.service';
import { UserFactsService } from './user-facts.service';

const query = z.object({ platform: z.enum(['ios', 'android', 'web']).optional(), appVersion: z.string().max(50).optional(), country: z.string().length(2).optional() });

/** App bootstrap configuration: evaluated feature flags, public settings, supported locales/countries. */
@ApiTags('config')
@Controller('config')
@UseGuards(OptionalUserAuthGuard)
export class ConfigController {
  constructor(
    private readonly flags: FlagsService,
    private readonly settings: SettingsService,
    private readonly facts: UserFactsService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly moduleRef: ModuleRef,
  ) {}

  @Get()
  async get(@Query(new ZodPipe(query)) q: z.infer<typeof query>, @Req() req: Request) {
    const client = { platform: q.platform, appVersion: q.appVersion };
    const facts = req.auth ? await this.facts.load(req.auth.userId, client) : { ...client, countryCode: q.country ?? null };
    const [flags, settings, locales, countries] = await Promise.all([
      this.flags.evaluateAll(facts),
      this.settings.publicSettings(),
      this.db.selectFrom('languages').select(['code', 'native_name', 'is_rtl']).where('is_app_locale', '=', true).where('is_active', '=', true).orderBy('code').execute(),
      this.db.selectFrom('countries').select(['code', 'default_currency', 'measurement', 'default_locale']).where('is_active', '=', true).orderBy('code').execute(),
    ]);
    // Resolved at runtime: the analytics module depends on this (platform) module, so no constructor injection.
    const experiments = req.auth ? await this.moduleRef.get(ExperimentsService, { strict: false }).assignments(req.auth.userId, ['onboarding', 'paywall', 'profile_layout', 'discovery', 'notifications', 'questionnaire', 'ai', 'other']) : {};
    return {
      experiments,
      flags,
      settings,
      locales: locales.map((l) => ({ code: l.code, nativeName: l.native_name, rtl: l.is_rtl })),
      countries: countries.map((c) => ({ code: c.code, currency: c.default_currency, measurement: c.measurement, defaultLocale: c.default_locale })),
    };
  }
}

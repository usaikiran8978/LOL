import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import { z } from 'zod';
import { countryCode, locale } from '@amora/shared';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { ZodPipe } from '../../common/http/zod.pipe';

const docType = z.enum(['terms', 'privacy', 'community_guidelines', 'safety', 'cookie', 'ai_terms']);
const query = z.object({ locale: locale.default('en'), country: countryCode.optional() });

/**
 * Public: the currently effective legal document for a locale/country. Falls back to the global document and then
 * to English. The returned id is what the client sends back as the accepted version at sign-up.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(':docType')
  async current(@Param('docType', new ZodPipe(docType)) type: z.infer<typeof docType>, @Query(new ZodPipe(query)) q: z.infer<typeof query>) {
    const doc = await this.db
      .selectFrom('legal_documents')
      .select(['id', 'doc_type', 'version', 'locale', 'country_code', 'title', 'body_md', 'effective_at'])
      .where('doc_type', '=', type)
      .where('status', '=', 'published')
      .where((eb) => eb.or([eb('effective_at', 'is', null), eb('effective_at', '<=', new Date())]))
      .where((eb) => eb.or([eb('country_code', 'is', null), ...(q.country ? [eb('country_code', '=', q.country)] : [])]))
      .where('locale', 'in', [...new Set([q.locale, q.locale.split('-')[0]!, 'en'])])
      .orderBy(sql`country_code IS NULL`) // country-specific first
      .orderBy(sql`CASE locale WHEN ${q.locale} THEN 0 WHEN ${q.locale.split('-')[0]} THEN 1 ELSE 2 END`)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!doc) throw new AppError('NOT_FOUND');
    return {
      id: doc.id,
      type: doc.doc_type,
      version: doc.version,
      locale: doc.locale,
      countryCode: doc.country_code,
      title: doc.title,
      bodyMarkdown: doc.body_md,
      effectiveAt: doc.effective_at ? new Date(doc.effective_at).toISOString() : null,
    };
  }
}

import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { countryCode, locale, taxonomyKind, TAXONOMY_KINDS } from '@amora/shared';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CatalogService } from './catalog.service';

const PUBLIC_KINDS = TAXONOMY_KINDS.filter((k) => k !== 'report_reason');
const localeQuery = z.object({ locale: locale.default('en') });
const termsQuery = localeQuery.extend({
  kinds: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(taxonomyKind).min(1).max(30)),
});
const citiesQuery = z.object({ country: countryCode.optional(), q: z.string().trim().min(1).max(80), limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Public reference data used by onboarding/profile editors. Cacheable at the CDN for a short time. */
@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('taxonomy')
  @Header('Cache-Control', 'public, max-age=300')
  terms(@Query(new ZodPipe(termsQuery)) q: z.infer<typeof termsQuery>) {
    return this.catalog.terms(q.kinds.filter((k) => (PUBLIC_KINDS as readonly string[]).includes(k)), q.locale);
  }

  @Get('report-reasons')
  reportReasons(@Query(new ZodPipe(localeQuery)) q: z.infer<typeof localeQuery>) {
    return this.catalog.terms(['report_reason'], q.locale);
  }

  @Get('interests')
  @Header('Cache-Control', 'public, max-age=300')
  interests(@Query(new ZodPipe(localeQuery)) q: z.infer<typeof localeQuery>) {
    return this.catalog.interests(q.locale);
  }

  @Get('prompts')
  @Header('Cache-Control', 'public, max-age=300')
  prompts(@Query(new ZodPipe(localeQuery)) q: z.infer<typeof localeQuery>) {
    return this.catalog.prompts(q.locale);
  }

  @Get('countries')
  @Header('Cache-Control', 'public, max-age=300')
  countries() {
    return this.catalog.countries();
  }

  @Get('languages')
  @Header('Cache-Control', 'public, max-age=300')
  languages() {
    return this.catalog.languages();
  }

  @Get('cities')
  cities(@Query(new ZodPipe(citiesQuery)) q: z.infer<typeof citiesQuery>) {
    return this.catalog.searchCities(q.country, q.q, q.limit);
  }
}

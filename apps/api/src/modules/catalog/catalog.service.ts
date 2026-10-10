import { Inject, Injectable } from '@nestjs/common';
import type { TaxonomyKind } from '@amora/shared';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../../common/db/database';
import { localeChain, pickTranslation } from '../../common/i18n/translations';

export interface TermDto {
  id: string;
  kind: string;
  key: string;
  label: string;
  description: string | null;
  parentId: string | null;
  sensitive: boolean;
}

/** Read side of admin-managed reference data, localized with fallback. */
@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async terms(kinds: readonly TaxonomyKind[] | string[], locale: string): Promise<TermDto[]> {
    if (kinds.length === 0) return [];
    const rows = await this.db
      .selectFrom('taxonomy_terms as t')
      .leftJoin('taxonomy_term_translations as tr', (j) => j.onRef('tr.term_id', '=', 't.id').on('tr.locale', 'in', localeChain(locale)))
      .select(['t.id', 't.kind', 't.key', 't.parent_id', 't.is_sensitive', 't.position', 'tr.locale', 'tr.label', 'tr.description'])
      .where('t.kind', 'in', kinds as string[])
      .where('t.is_active', '=', true)
      .orderBy('t.kind')
      .orderBy('t.position')
      .execute();
    return this.collapse(rows, locale, (r, tr) => ({
      id: r.id, kind: r.kind, key: r.key, label: tr?.label ?? r.key, description: tr?.description ?? null, parentId: r.parent_id, sensitive: r.is_sensitive,
    }));
  }

  async interests(locale: string) {
    const [cats, items] = await Promise.all([
      this.db
        .selectFrom('interest_categories as c')
        .leftJoin('interest_category_translations as tr', (j) => j.onRef('tr.category_id', '=', 'c.id').on('tr.locale', 'in', localeChain(locale)))
        .select(['c.id', 'c.key', 'c.icon', 'c.position', 'tr.locale', 'tr.label'])
        .where('c.is_active', '=', true)
        .orderBy('c.position')
        .execute(),
      this.db
        .selectFrom('interests as i')
        .leftJoin('interest_translations as tr', (j) => j.onRef('tr.interest_id', '=', 'i.id').on('tr.locale', 'in', localeChain(locale)))
        .select(['i.id', 'i.key', 'i.icon', 'i.category_id', 'i.position', 'tr.locale', 'tr.label'])
        .where('i.is_active', '=', true)
        .orderBy('i.position')
        .execute(),
    ]);
    const interests = this.collapse(items, locale, (r, tr) => ({ id: r.id, key: r.key, icon: r.icon, categoryId: r.category_id, label: tr?.label ?? r.key }));
    return this.collapse(cats, locale, (r, tr) => ({
      id: r.id, key: r.key, icon: r.icon, label: tr?.label ?? r.key, interests: interests.filter((i) => i.categoryId === r.id),
    }));
  }

  async prompts(locale: string) {
    const rows = await this.db
      .selectFrom('prompt_catalog as p')
      .leftJoin('prompt_catalog_translations as tr', (j) => j.onRef('tr.prompt_id', '=', 'p.id').on('tr.locale', 'in', localeChain(locale)))
      .select(['p.id', 'p.key', 'p.category', 'p.position', 'tr.locale', 'tr.text'])
      .where('p.is_active', '=', true)
      .orderBy('p.position')
      .execute();
    return this.collapse(rows, locale, (r, tr) => ({ id: r.id, key: r.key, category: r.category, text: tr?.text ?? r.key }));
  }

  countries() {
    return this.db.selectFrom('countries as c').leftJoin('country_configs as cc', 'cc.country_code', 'c.code')
      .select(['c.code', 'c.name', 'c.default_locale as defaultLocale', 'c.default_currency as currency', 'c.measurement', sql<number>`coalesce(cc.min_age, 18)`.as('minAge')])
      .where('c.is_active', '=', true).orderBy('c.name').execute();
  }

  languages() {
    return this.db.selectFrom('languages').select(['code', 'name', 'native_name as nativeName', 'is_rtl as rtl']).where('is_active', '=', true).orderBy('name').execute();
  }

  async searchCities(country: string | undefined, q: string, limit: number) {
    let qb = this.db
      .selectFrom('cities')
      .select(['id', 'country_code as countryCode', 'name', 'admin_region as region', 'timezone'])
      .where('is_active', '=', true)
      .where('name', 'ilike', `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
      .orderBy(sql`population DESC NULLS LAST`)
      .limit(limit);
    if (country) qb = qb.where('country_code', '=', country);
    return qb.execute();
  }

  /** Rows come one per (entity, translation); keep one row per entity using the best locale. */
  private collapse<R extends { id: string; locale: string | null }, O>(rows: R[], locale: string, map: (r: R, tr: R | undefined) => O): O[] {
    const groups = new Map<string, R[]>();
    for (const r of rows) groups.set(r.id, [...(groups.get(r.id) ?? []), r]);
    return [...groups.values()].map((g) => {
      const withLocale = g.filter((x): x is R & { locale: string } => x.locale !== null);
      return map(g[0]!, pickTranslation(withLocale, locale));
    });
  }
}

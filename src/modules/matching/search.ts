/**
 * Search abstraction (DEC-019). `PostgresSearchIndex` serves dev/test and small deployments; `OpenSearchIndex` is the
 * production adapter. Both return candidate ids only — authorization, privacy and scoring happen in SearchService.
 */
import { sql } from 'kysely';
import type { Database } from '../../common/db/database';
import { geohashNeighborhood } from '../../common/geo/geo';

export interface SearchFilters {
  viewerId: string;
  ageMin?: number;
  ageMax?: number;
  originGeohash?: string | null;
  radiusKm?: number;
  genderIds?: string[];
  intentIds?: string[];
  interestIds?: string[];
  languageCodes?: string[];
  attributeIds?: string[];
  verifiedOnly?: boolean;
  heightMinCm?: number;
  heightMaxCm?: number;
  q?: string;
  after?: { lastActive: string; id: string } | null;
  limit: number;
}

export interface SearchHit {
  id: string;
  lastActive: string;
}

export interface SearchIndex {
  search(f: SearchFilters): Promise<SearchHit[]>;
  upsert(doc: SearchDocument): Promise<void>;
  remove(userId: string): Promise<void>;
}

export interface SearchDocument {
  id: string;
  discoverable: boolean;
  birthDate: string | null;
  geohash5: string | null;
  genderId: string | null;
  intentId: string | null;
  interestIds: string[];
  languageCodes: string[];
  attributeIds: string[];
  verified: boolean;
  heightCm: number | null;
  bio: string | null;
  lastActive: string | null;
}

export const SEARCH_INDEX = Symbol('SEARCH_INDEX');

function bornBefore(years: number): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear() - years, t.getUTCMonth(), t.getUTCDate())).toISOString().slice(0, 10);
}

export function precisionForRadius(km: number): number {
  if (km > 600) return 2;
  if (km > 80) return 3;
  if (km > 20) return 4;
  return 5;
}

/** Queries the primary tables directly; profile writes are visible immediately so upsert/remove are no-ops. */
export class PostgresSearchIndex implements SearchIndex {
  constructor(private readonly db: Database) {}

  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}

  async search(f: SearchFilters): Promise<SearchHit[]> {
    let qb = this.db
      .selectFrom('user_profiles as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .select(['p.user_id', sql<string>`coalesce(u.last_active_at, u.created_at)`.as('last_active')])
      .where('p.is_discoverable', '=', true)
      .where('u.status', '=', 'active')
      .where('p.user_id', '<>', f.viewerId);
    if (f.ageMin) qb = qb.where('u.date_of_birth', '<=', bornBefore(f.ageMin));
    if (f.ageMax) qb = qb.where('u.date_of_birth', '>', bornBefore(f.ageMax + 1));
    if (f.genderIds?.length) qb = qb.where('p.gender_id', 'in', f.genderIds);
    if (f.intentIds?.length) qb = qb.where('p.dating_intent_id', 'in', f.intentIds);
    if (f.verifiedOnly) qb = qb.where('p.verification_level', 'in', ['selfie', 'identity']);
    if (f.heightMinCm) qb = qb.where('p.height_cm', '>=', f.heightMinCm);
    if (f.heightMaxCm) qb = qb.where('p.height_cm', '<=', f.heightMaxCm);
    if (f.interestIds?.length) qb = qb.where((eb) => eb.exists(eb.selectFrom('user_interests as i').select(sql`1`.as('x')).whereRef('i.user_id', '=', 'p.user_id').where('i.interest_id', 'in', f.interestIds!)));
    if (f.languageCodes?.length) qb = qb.where((eb) => eb.exists(eb.selectFrom('user_languages as l').select(sql`1`.as('x')).whereRef('l.user_id', '=', 'p.user_id').where('l.language_code', 'in', f.languageCodes!)));
    for (const a of f.attributeIds ?? []) qb = qb.where((eb) => eb.exists(eb.selectFrom('user_profile_attributes as a').select(sql`1`.as('x')).whereRef('a.user_id', '=', 'p.user_id').where('a.term_id', '=', a)));
    if (f.q) qb = qb.where('p.bio', 'ilike', `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    if (f.originGeohash && f.radiusKm) {
      const cells = geohashNeighborhood(f.originGeohash.slice(0, precisionForRadius(f.radiusKm)));
      qb = qb.where((eb) => eb.or(cells.map((c) => eb('p.geohash5', 'like', `${c}%`))));
    }
    if (f.after) {
      const { lastActive, id } = f.after;
      qb = qb.where((eb) => eb.or([eb(sql`coalesce(u.last_active_at, u.created_at)`, '<', new Date(lastActive)), eb.and([eb(sql`coalesce(u.last_active_at, u.created_at)`, '=', new Date(lastActive)), eb('p.user_id', '<', id)])]));
    }
    const rows = await qb.orderBy(sql`coalesce(u.last_active_at, u.created_at)`, 'desc').orderBy('p.user_id', 'desc').limit(f.limit).execute();
    return rows.map((r) => ({ id: r.user_id, lastActive: new Date(r.last_active).toISOString() }));
  }
}

/** Builds the OpenSearch query body for the same filter semantics as the Postgres adapter (unit-tested). */
export function openSearchQuery(f: SearchFilters): Record<string, unknown> {
  const filter: unknown[] = [{ term: { discoverable: true } }];
  const mustNot: unknown[] = [{ term: { id: f.viewerId } }];
  const range = (field: string, gte?: unknown, lte?: unknown) => ({ range: { [field]: { ...(gte !== undefined ? { gte } : {}), ...(lte !== undefined ? { lte } : {}) } } });
  if (f.ageMin || f.ageMax) filter.push({ range: { birthDate: { ...(f.ageMin ? { lte: bornBefore(f.ageMin) } : {}), ...(f.ageMax ? { gt: bornBefore(f.ageMax + 1) } : {}) } } });
  if (f.genderIds?.length) filter.push({ terms: { genderId: f.genderIds } });
  if (f.intentIds?.length) filter.push({ terms: { intentId: f.intentIds } });
  if (f.interestIds?.length) filter.push({ terms: { interestIds: f.interestIds } });
  if (f.languageCodes?.length) filter.push({ terms: { languageCodes: f.languageCodes } });
  for (const a of f.attributeIds ?? []) filter.push({ term: { attributeIds: a } });
  if (f.verifiedOnly) filter.push({ term: { verified: true } });
  if (f.heightMinCm || f.heightMaxCm) filter.push(range('heightCm', f.heightMinCm, f.heightMaxCm));
  if (f.originGeohash && f.radiusKm) {
    const cells = geohashNeighborhood(f.originGeohash.slice(0, precisionForRadius(f.radiusKm)));
    filter.push({ bool: { should: cells.map((c) => ({ prefix: { geohash5: c } })), minimum_should_match: 1 } });
  }
  const must = f.q ? [{ match: { bio: { query: f.q, operator: 'and' } } }] : [];
  return {
    size: f.limit,
    query: { bool: { filter, must_not: mustNot, must } },
    sort: [{ lastActive: 'desc' }, { id: 'desc' }],
    ...(f.after ? { search_after: [f.after.lastActive, f.after.id] } : {}),
  };
}

export class OpenSearchIndex implements SearchIndex {
  constructor(private readonly baseUrl: string, private readonly index: string, private readonly auth?: string) {}

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.auth ? { Authorization: `Basic ${Buffer.from(this.auth).toString('base64')}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`OpenSearch ${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.status === 404 ? null : res.json();
  }

  async search(f: SearchFilters): Promise<SearchHit[]> {
    const r = await this.call('POST', `${this.index}/_search`, openSearchQuery(f));
    return (r?.hits?.hits ?? []).map((h: { _source: SearchDocument }) => ({ id: h._source.id, lastActive: h._source.lastActive ?? new Date(0).toISOString() }));
  }

  async upsert(doc: SearchDocument): Promise<void> {
    await this.call('PUT', `${this.index}/_doc/${doc.id}`, doc);
  }

  async remove(userId: string): Promise<void> {
    await this.call('DELETE', `${this.index}/_doc/${userId}`);
  }
}

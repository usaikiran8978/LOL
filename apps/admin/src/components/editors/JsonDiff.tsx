'use client';

import { t } from '@/i18n';

type Flat = Map<string, unknown>;

function flatten(value: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value) && value.length > 0) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else {
    out.set(prefix || '(root)', value);
  }
  return out;
}

export interface DiffRow {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

/** Leaf-level diff between two JSON values (audit before/after states). */
export function diffJson(before: unknown, after: unknown): DiffRow[] {
  const a = before === null || before === undefined ? new Map() : flatten(before);
  const b = after === null || after === undefined ? new Map() : flatten(after);
  const rows: DiffRow[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const inA = a.has(path);
    const inB = b.has(path);
    if (inA && !inB) rows.push({ path, kind: 'removed', before: a.get(path) });
    else if (!inA && inB) rows.push({ path, kind: 'added', after: b.get(path) });
    else if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))) rows.push({ path, kind: 'changed', before: a.get(path), after: b.get(path) });
  }
  return rows.sort((x, y) => x.path.localeCompare(y.path));
}

const show = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  if ((before === null || before === undefined) && (after === null || after === undefined)) return <p className="muted">{t('diff.noState')}</p>;
  const rows = diffJson(before, after);
  return (
    <div className="diff">
      {rows.length === 0 ? (
        <p className="muted">{t('diff.noChanges')}</p>
      ) : (
        <table className="table table--compact">
          <thead>
            <tr>
              <th scope="col">{t('diff.path')}</th>
              <th scope="col">{t('common.status')}</th>
              <th scope="col">{t('diff.before')}</th>
              <th scope="col">{t('diff.after')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className={`diff__row diff__row--${r.kind}`}>
                <th scope="row"><code>{r.path}</code></th>
                <td>{t(`diff.${r.kind}`)}</td>
                <td><code className="diff__before">{show(r.before) || t('diff.empty')}</code></td>
                <td><code className="diff__after">{show(r.after) || t('diff.empty')}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary>{t('diff.rawBefore')}</summary>
        <pre className="code">{JSON.stringify(before ?? null, null, 2)}</pre>
      </details>
      <details>
        <summary>{t('diff.rawAfter')}</summary>
        <pre className="code">{JSON.stringify(after ?? null, null, 2)}</pre>
      </details>
    </div>
  );
}

'use client';

import { adminMatchingConfigInput } from '@amora/shared';
import { Badge } from '@/components/ui/Badge';
import { NumberField } from '@/components/ui/fields';
import { BoolBadge } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { CompatibilityCategoryRow } from '@/lib/api/modules/matching';
import { formatNumber } from '@/lib/format';
import type { FieldErrors } from '@/lib/forms/validate';
import { WEIGHT_TOLERANCE, weightSum } from './configForm';
import type { FormUpdate } from './ConfigFields';
import type { ConfigForm } from './configForm';
import { categoryLabel } from './shared';

const weightSchema = adminMatchingConfigInput.shape.weights.valueType;

/**
 * Category weights: one row per compatibility category (plus any key only present in this version). An empty
 * weight means the category is not weighted in this version.
 */
export function WeightsEditor({ form, update, errors, categories }: {
  form: ConfigForm; update: FormUpdate; errors: FieldErrors; categories: CompatibilityCategoryRow[] | undefined;
}) {
  const byKey = new Map((categories ?? []).map((c) => [c.key, c]));
  const keys = [...(categories ?? []).map((c) => c.key), ...Object.keys(form.weights).filter((k) => !byKey.has(k)).sort()];
  const sum = weightSum(form.weights);
  const balanced = Math.abs(sum - 1) <= WEIGHT_TOLERANCE;

  return (
    <section className="card" aria-labelledby="matching-weights">
      <h2 id="matching-weights" className="card__title">{t('matching.editor.sections.weights')}</h2>
      <p className="field__hint">{t('matching.editor.weights.hint')}</p>
      {errors.weights ? <p className="field__error" role="alert">{errors.weights}</p> : null}
      {keys.length === 0 ? (
        <p className="muted">{t('matching.editor.weights.noCategories')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('matching.categories.category')}</th>
                <th scope="col">{t('matching.categories.source')}</th>
                <th scope="col">{t('matching.categories.inOverall')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('matching.editor.weights.weight')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const c = byKey.get(k);
                return (
                  <tr key={k} className={!c ? 'is-warning' : undefined}>
                    <th scope="row">
                      {categoryLabel(c, k)} <code>{k}</code>
                      {!c ? <> <Badge tone="warning">{t('matching.editor.weights.unknownCategory')}</Badge></> : null}
                    </th>
                    <td>{c ? tDynamic(`matching.source.${c.source}`, c.source) : '—'}</td>
                    <td>{c ? <BoolBadge value={c.in_overall} /> : '—'}</td>
                    <td>{c ? <BoolBadge value={c.is_active} on={t('common.active')} off={t('common.inactive')} /> : '—'}</td>
                    <td>
                      <NumberField
                        className="field--bare-label field--inline"
                        label={t('matching.editor.weights.weightFor', { key: k })}
                        value={form.weights[k]}
                        onChange={(v) => update((f) => ({ ...f, weights: { ...f.weights, [k]: v } }))}
                        error={errors[`weights.${k}`]}
                        min={weightSchema.minValue ?? undefined}
                        max={weightSchema.maxValue ?? undefined}
                        step="any"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>{t('matching.editor.weights.sum')}</th>
                <td className="num">
                  <output aria-live="polite">{formatNumber(sum, 4)}</output>{' '}
                  {balanced ? <Badge tone="success">{t('matching.editor.weights.balanced')}</Badge> : <Badge tone="warning">{t('matching.editor.weights.unbalanced')}</Badge>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {categories === undefined ? <p className="muted">{t('matching.editor.weights.categoriesUnavailable')}</p> : null}
    </section>
  );
}

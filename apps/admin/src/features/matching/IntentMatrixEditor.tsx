'use client';

import { adminMatchingConfigInput } from '@amora/shared';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { NumberField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { pairKey, type ConfigForm, type IntentCell } from './configForm';
import type { FormUpdate } from './ConfigFields';

const INTENT_KEY = /^[a-z0-9_]{1,64}$/;
const MAX_PAIRS = 400;
const scoreSchema = adminMatchingConfigInput.shape.intentMatrix.element.shape.score;

interface Props {
  form: ConfigForm;
  update: FormUpdate;
  /** Errors per canonical pair key (mapped from `intentMatrix.<i>.*` paths by the page). */
  cellErrors: Record<string, string>;
  matrixError?: string;
  /**
   * Active dating_intent keys from the taxonomy when the admin can read it (they are all on the axis already; the
   * picker offers ones removed from it). null = taxonomy not readable: the axis comes from the config plus typed keys.
   */
  taxonomyIntents: string[] | null;
  /** Default score shown for pairs that are not configured. */
  defaultScore: number | undefined;
}

/**
 * Symmetric intent compatibility grid (upper triangle incl. diagonal; the API mirrors every pair). The axis is the
 * set of intents the config already mentions plus intents the admin adds.
 */
export function IntentMatrixEditor({ form, update, cellErrors, matrixError, taxonomyIntents, defaultScore }: Props) {
  const intents = form.intents;
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<string | undefined>();
  const hintId = useId();
  const configured = Object.entries(form.intentCells).filter(([, c]) => c.score !== undefined || c.hardExclusion).length;
  const candidates = (taxonomyIntents ?? []).filter((k) => !intents.includes(k));

  function addIntent() {
    const key = adding.trim();
    if (!INTENT_KEY.test(key)) return setAddError(t('matching.editor.intents.keyInvalid'));
    if (intents.includes(key)) return setAddError(t('validation.duplicate', { value: key }));
    setAddError(undefined);
    setAdding('');
    update((f) => ({ ...f, intents: [...f.intents, key].sort() }));
  }

  function removeIntent(key: string) {
    update((f) => ({
      ...f,
      intents: f.intents.filter((i) => i !== key),
      intentCells: Object.fromEntries(Object.entries(f.intentCells).filter(([k]) => !k.split('|').includes(key))),
    }));
  }

  const setCell = (a: string, b: string, patch: Partial<IntentCell>) =>
    update((f) => {
      const k = pairKey(a, b);
      const prev = f.intentCells[k] ?? { score: undefined, hardExclusion: false };
      return { ...f, intentCells: { ...f.intentCells, [k]: { ...prev, ...patch } } };
    });

  return (
    <section className="card" aria-labelledby="matching-intents">
      <h2 id="matching-intents" className="card__title">{t('matching.editor.sections.intents')}</h2>
      <p className="field__hint" id={hintId}>{t('matching.editor.intents.hint', { score: formatNumber(defaultScore) })}</p>
      {taxonomyIntents === null ? <p className="muted">{t('matching.editor.intents.taxonomyUnavailable')}</p> : null}
      {matrixError ? <p className="field__error" role="alert">{matrixError}</p> : null}
      {configured > MAX_PAIRS ? <p className="field__error" role="alert">{t('validation.tooManyItems', { max: MAX_PAIRS })}</p> : null}
      {intents.length === 0 ? (
        <p className="muted">{t('matching.editor.intents.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--compact" aria-describedby={hintId}>
            <caption className="visually-hidden">{t('matching.editor.intents.caption')}</caption>
            <thead>
              <tr>
                <th scope="col"><span className="visually-hidden">{t('matching.editor.intents.intent')}</span></th>
                {intents.map((b) => <th key={b} scope="col"><code>{b}</code></th>)}
              </tr>
            </thead>
            <tbody>
              {intents.map((a, i) => (
                <tr key={a}>
                  <th scope="row">
                    <code>{a}</code>{' '}
                    <Button variant="ghost" size="sm" onClick={() => removeIntent(a)} aria-label={t('matching.editor.intents.removeIntent', { key: a })}>×</Button>
                  </th>
                  {intents.map((b, j) => {
                    if (j < i) return <td key={b} className="muted"><span aria-hidden="true">↔</span><span className="visually-hidden">{t('matching.editor.intents.mirrored')}</span></td>;
                    const k = pairKey(a, b);
                    const cell = form.intentCells[k];
                    return (
                      <td key={b}>
                        <NumberField
                          className="field--bare-label field--inline"
                          label={t('matching.editor.intents.scoreFor', { a, b })}
                          value={cell?.score}
                          onChange={(score) => setCell(a, b, { score })}
                          error={cellErrors[k]}
                          placeholder={formatNumber(defaultScore)}
                          min={scoreSchema.minValue ?? undefined}
                          max={scoreSchema.maxValue ?? undefined}
                          step="any"
                        />
                        <label className="row">
                          <input
                            type="checkbox"
                            checked={cell?.hardExclusion ?? false}
                            onChange={(e) => setCell(a, b, { hardExclusion: e.target.checked })}
                            aria-label={t('matching.editor.intents.hardFor', { a, b })}
                          />
                          <span aria-hidden="true">{t('matching.editor.intents.hard')}</span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {taxonomyIntents === null || candidates.length > 0 ? (
        <div className="row row--end">
          {taxonomyIntents !== null ? (
            <SelectField
              className="field--inline"
              label={t('matching.editor.intents.addIntent')}
              value={adding}
              onChange={setAdding}
              options={candidates.map((k) => ({ value: k, label: k }))}
              placeholder={t('matching.editor.intents.choose')}
              error={addError}
            />
          ) : (
            <TextField className="field--inline" label={t('matching.editor.intents.addIntent')} hint={t('matching.editor.intents.addHint')} value={adding} onChange={setAdding} error={addError} spellCheck={false} />
          )}
          <Button variant="secondary" onClick={addIntent} disabled={!adding.trim()}>{t('common.add')}</Button>
        </div>
      ) : null}
    </section>
  );
}

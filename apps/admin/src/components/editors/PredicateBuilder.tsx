'use client';

import type { Predicate } from '@amora/shared';
import { useEffect, useId, useState } from 'react';
import { t } from '@/i18n';
import {
  OPS, VALUE_TYPES, fromNode, newCondition, newGroup, nextId, parsePredicateJson, toNode, updateNode,
  type Conversion, type Op, type PNode, type ValueType,
} from '@/lib/predicate';
import { Button } from '../ui/Button';
import { SelectField, TextAreaField, TextField } from '../ui/fields';

export function conversionMessage(c: Extract<Conversion, { ok: false }>): string {
  return t(`predicate.errors.${c.error}`, { path: c.path || 'root' });
}

interface Props {
  initial?: Predicate | null;
  /** Called with the converted + zod-validated predicate (or the reason it is invalid) after every edit. */
  onChange: (result: Conversion) => void;
  label?: string;
}

/** Visual builder for the shared predicate language with a JSON view; both validate with the shared zod schema. */
export function PredicateBuilder({ initial, onChange, label }: Props) {
  const [root, setRoot] = useState<PNode>(() => (initial ? toNode(initial) : newGroup('all')));
  const [mode, setMode] = useState<'builder' | 'json'>('builder');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | undefined>();
  const result = fromNode(root);
  const groupId = useId();

  useEffect(() => {
    onChange(result);
    // Report only when the tree changes; `result` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  function update(id: string, fn: (n: PNode) => PNode | null) {
    setRoot((r) => updateNode(r, id, fn) ?? newGroup('all'));
  }

  function switchMode(next: 'builder' | 'json') {
    if (next === 'json') {
      setJsonText(result.ok ? JSON.stringify(result.value, null, 2) : '');
      setJsonError(undefined);
    }
    setMode(next);
  }

  function applyJson() {
    const r = parsePredicateJson(jsonText);
    if (!r.ok) return setJsonError(conversionMessage(r));
    setJsonError(undefined);
    setRoot(toNode(r.value));
    setMode('builder');
  }

  return (
    <fieldset className="predicate">
      <legend>{label ?? t('segments.definition')}</legend>
      <div role="group" aria-label={t('predicate.viewLabel')} className="segmented" id={groupId}>
        <button type="button" aria-pressed={mode === 'builder'} onClick={() => switchMode('builder')}>{t('predicate.builder')}</button>
        <button type="button" aria-pressed={mode === 'json'} onClick={() => switchMode('json')}>{t('predicate.json')}</button>
      </div>
      {mode === 'builder' ? (
        <>
          <NodeEditor node={root} isRoot update={update} />
          <p className={result.ok ? 'field__hint' : 'field__error'} role={result.ok ? undefined : 'alert'}>
            {result.ok ? t('predicate.valid') : conversionMessage(result)}
          </p>
        </>
      ) : (
        <>
          <TextAreaField label={t('json.label')} value={jsonText} onChange={setJsonText} rows={12} error={jsonError} spellCheck={false} className="code-input" />
          <Button variant="secondary" size="sm" onClick={applyJson}>{t('predicate.applyJson')}</Button>
        </>
      )}
    </fieldset>
  );
}

type Update = (id: string, fn: (n: PNode) => PNode | null) => void;

function NodeEditor({ node, update, isRoot }: { node: PNode; update: Update; isRoot?: boolean }) {
  if (node.kind === 'group') {
    return (
      <div className="predicate__group" role="group" aria-label={t('predicate.groupLabel', { mode: node.mode === 'all' ? t('predicate.all') : t('predicate.any') })}>
        <div className="row">
          <SelectField
            label={t('predicate.changeGroup')}
            value={node.mode}
            onChange={(v) => update(node.id, (n) => ({ ...(n as Extract<PNode, { kind: 'group' }>), mode: v as 'all' | 'any' }))}
            options={[{ value: 'all', label: t('predicate.all') }, { value: 'any', label: t('predicate.any') }]}
            className="field--inline"
          />
          {!isRoot ? <Button variant="ghost" size="sm" onClick={() => update(node.id, () => null)}>{t('predicate.removeNode')}</Button> : null}
        </div>
        <ul className="predicate__children">
          {node.children.map((c) => (
            <li key={c.id}>
              <NodeEditor node={c} update={update} />
            </li>
          ))}
        </ul>
        <div className="row">
          <Button variant="secondary" size="sm" onClick={() => update(node.id, (n) => ({ ...(n as Extract<PNode, { kind: 'group' }>), children: [...(n as Extract<PNode, { kind: 'group' }>).children, newCondition()] }))}>
            {t('predicate.addCondition')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => update(node.id, (n) => ({ ...(n as Extract<PNode, { kind: 'group' }>), children: [...(n as Extract<PNode, { kind: 'group' }>).children, newGroup('any')] }))}>
            {t('predicate.addGroup')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => update(node.id, (n) => ({ ...(n as Extract<PNode, { kind: 'group' }>), children: [...(n as Extract<PNode, { kind: 'group' }>).children, { id: nextId(), kind: 'not', child: newCondition() }] }))}>
            {t('predicate.addNot')}
          </Button>
        </div>
      </div>
    );
  }

  if (node.kind === 'not') {
    return (
      <div className="predicate__not" role="group" aria-label={t('predicate.not')}>
        <div className="row">
          <strong>{t('predicate.not')}</strong>
          <Button variant="ghost" size="sm" onClick={() => update(node.id, (n) => (n as Extract<PNode, { kind: 'not' }>).child)}>{t('predicate.unwrapNot')}</Button>
          {!isRoot ? <Button variant="ghost" size="sm" onClick={() => update(node.id, () => null)}>{t('predicate.removeNode')}</Button> : null}
        </div>
        <NodeEditor node={node.child} update={update} />
      </div>
    );
  }

  const set = (patch: Partial<Extract<PNode, { kind: 'cond' }>>) => update(node.id, (n) => ({ ...(n as Extract<PNode, { kind: 'cond' }>), ...patch }));
  const valueHidden = node.op === 'exists' || node.valueType === 'none';
  return (
    <div className="predicate__cond" role="group" aria-label={t('predicate.condition')}>
      <TextField label={t('predicate.field')} hint={t('predicate.fieldHint')} value={node.field} onChange={(field) => set({ field })} className="field--inline" spellCheck={false} />
      <SelectField
        label={t('predicate.operator')}
        value={node.op}
        onChange={(v) => {
          const op = v as Op;
          // Keep the value type coherent with the operator (exists has no value; in/nin take lists).
          if (op === 'exists') set({ op, valueType: 'none' });
          else if ((op === 'in' || op === 'nin') && !['list', 'numberList', 'json'].includes(node.valueType)) set({ op, valueType: 'list' });
          else if (node.valueType === 'none') set({ op, valueType: 'string' });
          else set({ op });
        }}
        options={OPS.map((o) => ({ value: o, label: t(`predicate.ops.${o}`) }))}
        className="field--inline"
      />
      {node.op !== 'exists' ? (
        <SelectField
          label={t('predicate.valueType')}
          value={node.valueType}
          onChange={(v) => set({ valueType: v as ValueType })}
          options={VALUE_TYPES.map((v) => ({ value: v, label: t(`predicate.types.${v}`) }))}
          className="field--inline"
        />
      ) : null}
      {valueHidden ? null : node.valueType === 'boolean' ? (
        <SelectField
          label={t('predicate.value')}
          value={node.bool ? 'true' : 'false'}
          onChange={(v) => set({ bool: v === 'true' })}
          options={[{ value: 'true', label: t('predicate.boolTrue') }, { value: 'false', label: t('predicate.boolFalse') }]}
          className="field--inline"
        />
      ) : node.valueType === 'json' ? (
        <TextAreaField label={t('predicate.value')} value={node.text} onChange={(text) => set({ text })} rows={3} spellCheck={false} className="field--inline code-input" />
      ) : (
        <TextField
          label={t('predicate.value')}
          hint={node.valueType === 'list' || node.valueType === 'numberList' ? t('predicate.listHint') : undefined}
          inputMode={node.valueType === 'number' || node.valueType === 'numberList' ? 'decimal' : undefined}
          value={node.text}
          onChange={(text) => set({ text })}
          className="field--inline"
        />
      )}
      <div className="row">
        <Button variant="ghost" size="sm" onClick={() => update(node.id, (n) => ({ id: nextId(), kind: 'not', child: n }))}>{t('predicate.wrapNot')}</Button>
        {!isRoot ? <Button variant="ghost" size="sm" onClick={() => update(node.id, () => null)}>{t('predicate.removeNode')}</Button> : null}
      </div>
    </div>
  );
}

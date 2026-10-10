import type { Predicate } from '@amora/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PredicateBuilder } from '@/components/editors/PredicateBuilder';
import { t } from '@/i18n';
import { fromNode, newCondition, parsePredicateJson, toNode, type Conversion } from './predicate';

const samples: Predicate[] = [
  { field: 'country', op: 'eq', value: 'DE' },
  { field: 'profile.age', op: 'gte', value: 30 },
  { field: 'verified', op: 'eq', value: true },
  { field: 'phone', op: 'exists' },
  { field: 'country', op: 'in', value: ['DE', 'FR'] },
  { field: 'tier', op: 'nin', value: [1, 2, 3] },
  { field: 'tags', op: 'contains', value: { nested: [1, 'a'] } },
  { field: 'odd', op: 'in', value: ['has, comma', ' padded'] },
  {
    all: [
      { field: 'country', op: 'in', value: ['DE'] },
      { any: [{ field: 'age', op: 'lt', value: 25 }, { not: { field: 'premium', op: 'eq', value: false } }] },
    ],
  },
  { not: { any: [{ field: 'a', op: 'neq', value: '' }] } },
];

describe('predicate tree ↔ JSON', () => {
  it.each(samples.map((s) => [JSON.stringify(s), s] as const))('round-trips %s', (_, p) => {
    const r = fromNode(toNode(p));
    expect(r).toEqual({ ok: true, value: p });
  });

  it('reports incomplete conditions instead of guessing', () => {
    expect(fromNode(newCondition())).toMatchObject({ ok: false, error: 'missing_field' });
    const node = toNode({ field: 'age', op: 'gt', value: 1 });
    if (node.kind !== 'cond') throw new Error('expected condition');
    expect(fromNode({ ...node, text: 'abc' })).toMatchObject({ ok: false, error: 'not_number' });
    expect(fromNode({ id: 'g', kind: 'group', mode: 'all', children: [] })).toMatchObject({ ok: false, error: 'empty_group' });
  });

  it('validates with the shared zod schema', () => {
    expect(parsePredicateJson('{"field":"1bad","op":"eq","value":1}')).toMatchObject({ ok: false, error: 'schema' });
    expect(parsePredicateJson('{nope')).toMatchObject({ ok: false, error: 'json_parse' });
    expect(parsePredicateJson('{"all":[{"field":"a","op":"exists"}]}')).toEqual({ ok: true, value: { all: [{ field: 'a', op: 'exists' }] } });
  });
});

describe('PredicateBuilder', () => {
  it('builds a predicate visually and shows it in the JSON view', async () => {
    const user = userEvent.setup();
    let last: Conversion | null = null;
    render(<PredicateBuilder onChange={(r) => (last = r)} />);
    expect(last).toMatchObject({ ok: false, error: 'missing_field' });
    await user.type(screen.getByLabelText(t('predicate.field')), 'country');
    await user.type(screen.getByLabelText(t('predicate.value')), 'DE');
    expect(last).toEqual({ ok: true, value: { all: [{ field: 'country', op: 'eq', value: 'DE' }] } });
    expect(screen.getByText(t('predicate.valid'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('predicate.json') }));
    expect(JSON.parse((screen.getByLabelText(t('json.label')) as HTMLTextAreaElement).value)).toEqual({ all: [{ field: 'country', op: 'eq', value: 'DE' }] });
  });

  it('applies valid JSON to the builder and rejects invalid JSON', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PredicateBuilder initial={{ field: 'a', op: 'exists' }} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: t('predicate.json') }));
    const box = screen.getByLabelText(t('json.label'));
    fireEvent.change(box, { target: { value: '{"any":[{"field":"x","op":"in","value":["a","b"]}]}' } });
    await user.click(screen.getByRole('button', { name: t('predicate.applyJson') }));
    expect(onChange).toHaveBeenLastCalledWith({ ok: true, value: { any: [{ field: 'x', op: 'in', value: ['a', 'b'] }] } });
    expect((screen.getByLabelText(t('predicate.value')) as HTMLInputElement).value).toBe('a, b');

    await user.click(screen.getByRole('button', { name: t('predicate.json') }));
    fireEvent.change(screen.getByLabelText(t('json.label')), { target: { value: '{"field":"x"}' } });
    await user.click(screen.getByRole('button', { name: t('predicate.applyJson') }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

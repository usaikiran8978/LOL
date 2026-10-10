import { predicate as predicateSchema, type Predicate } from '@amora/shared';

/*
 * Editable tree for the shared `Predicate` language. Values are kept as typed text while editing so the
 * builder can hold half-typed input; `fromNode` converts back and reports problems instead of guessing.
 * toNode → fromNode is lossless: anything the typed editors cannot represent exactly falls back to raw JSON.
 */

export type Op = Extract<Predicate, { op: unknown }>['op'];
export const OPS: Op[] = ['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists', 'contains'];
export type ValueType = 'none' | 'string' | 'number' | 'boolean' | 'list' | 'numberList' | 'json';
export const VALUE_TYPES: ValueType[] = ['none', 'string', 'number', 'boolean', 'list', 'numberList', 'json'];

export type PNode =
  | { id: string; kind: 'group'; mode: 'all' | 'any'; children: PNode[] }
  | { id: string; kind: 'not'; child: PNode }
  | { id: string; kind: 'cond'; field: string; op: Op; valueType: ValueType; text: string; bool: boolean };

let seq = 0;
export const nextId = () => `p${++seq}`;

export function newCondition(): PNode {
  return { id: nextId(), kind: 'cond', field: '', op: 'eq', valueType: 'string', text: '', bool: true };
}

export function newGroup(mode: 'all' | 'any' = 'all'): PNode {
  return { id: nextId(), kind: 'group', mode, children: [newCondition()] };
}

const listSafe = (s: string) => s !== '' && s === s.trim() && !s.includes(',');

function inferValue(value: unknown): Pick<Extract<PNode, { kind: 'cond' }>, 'valueType' | 'text' | 'bool'> {
  if (value === undefined) return { valueType: 'none', text: '', bool: true };
  if (typeof value === 'string') return { valueType: 'string', text: value, bool: true };
  if (typeof value === 'number' && Number.isFinite(value)) return { valueType: 'number', text: String(value), bool: true };
  if (typeof value === 'boolean') return { valueType: 'boolean', text: '', bool: value };
  if (Array.isArray(value) && value.length > 0) {
    if (value.every((v) => typeof v === 'string' && listSafe(v))) return { valueType: 'list', text: value.join(', '), bool: true };
    if (value.every((v) => typeof v === 'number' && Number.isFinite(v))) return { valueType: 'numberList', text: value.join(', '), bool: true };
  }
  return { valueType: 'json', text: JSON.stringify(value, null, 2), bool: true };
}

export function toNode(p: Predicate): PNode {
  if ('all' in p) return { id: nextId(), kind: 'group', mode: 'all', children: p.all.map(toNode) };
  if ('any' in p) return { id: nextId(), kind: 'group', mode: 'any', children: p.any.map(toNode) };
  if ('not' in p) return { id: nextId(), kind: 'not', child: toNode(p.not) };
  return { id: nextId(), kind: 'cond', field: p.field, op: p.op, ...inferValue(p.value) };
}

export type ConversionError = 'missing_field' | 'not_number' | 'empty_list' | 'not_number_list' | 'invalid_json' | 'empty_group' | 'json_parse' | 'schema';
export type Conversion = { ok: true; value: Predicate } | { ok: false; error: ConversionError; nodeId?: string; path?: string };

function convertValue(n: Extract<PNode, { kind: 'cond' }>): { ok: true; value: unknown } | { ok: false; error: ConversionError } {
  const items = () => n.text.split(',').map((s) => s.trim()).filter(Boolean);
  switch (n.valueType) {
    case 'none':
      return { ok: true, value: undefined };
    case 'string':
      return { ok: true, value: n.text };
    case 'boolean':
      return { ok: true, value: n.bool };
    case 'number': {
      const v = Number(n.text);
      return n.text.trim() === '' || !Number.isFinite(v) ? { ok: false, error: 'not_number' } : { ok: true, value: v };
    }
    case 'list':
      return items().length ? { ok: true, value: items() } : { ok: false, error: 'empty_list' };
    case 'numberList': {
      const nums = items().map(Number);
      return nums.length && nums.every(Number.isFinite) ? { ok: true, value: nums } : { ok: false, error: 'not_number_list' };
    }
    case 'json':
      try {
        return { ok: true, value: JSON.parse(n.text) as unknown };
      } catch {
        return { ok: false, error: 'invalid_json' };
      }
  }
}

/** Tree → Predicate, then validated with the shared zod schema (the same one the API uses). */
export function fromNode(node: PNode): Conversion {
  const raw = build(node);
  if (!raw.ok) return raw;
  const parsed = predicateSchema.safeParse(raw.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: 'schema', path: issue?.path.join('.') ?? '' };
  }
  return { ok: true, value: raw.value };
}

function build(node: PNode): Conversion {
  if (node.kind === 'group') {
    if (node.children.length === 0) return { ok: false, error: 'empty_group', nodeId: node.id };
    const children: Predicate[] = [];
    for (const c of node.children) {
      const r = build(c);
      if (!r.ok) return r;
      children.push(r.value);
    }
    return { ok: true, value: node.mode === 'all' ? { all: children } : { any: children } };
  }
  if (node.kind === 'not') {
    const r = build(node.child);
    return r.ok ? { ok: true, value: { not: r.value } } : r;
  }
  if (!node.field.trim()) return { ok: false, error: 'missing_field', nodeId: node.id };
  const v = convertValue(node);
  if (!v.ok) return { ok: false, error: v.error, nodeId: node.id };
  const out: Predicate = { field: node.field.trim(), op: node.op };
  if (v.value !== undefined) (out as { value?: unknown }).value = v.value;
  return { ok: true, value: out };
}

/** Parses JSON text as a predicate (JSON view "Apply"). */
export function parsePredicateJson(text: string): Conversion {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json_parse' };
  }
  const parsed = predicateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: 'schema', path: issue?.path.join('.') ?? '' };
  }
  return { ok: true, value: parsed.data };
}

/** Immutable update of the node with `id`. */
export function updateNode(root: PNode, id: string, fn: (n: PNode) => PNode | null): PNode | null {
  if (root.id === id) return fn(root);
  if (root.kind === 'group') {
    const children = root.children.map((c) => updateNode(c, id, fn)).filter((c): c is PNode => c !== null);
    return { ...root, children };
  }
  if (root.kind === 'not') {
    const child = updateNode(root.child, id, fn);
    // Removing the only child of a NOT removes the NOT too.
    return child ? { ...root, child } : null;
  }
  return root;
}

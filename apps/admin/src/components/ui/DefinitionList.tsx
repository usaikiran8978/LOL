import type { ReactNode } from 'react';

/** Label/value pairs for detail views (wraps to one column on narrow screens; direction-agnostic). */
export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode } | null | false> }) {
  return (
    <dl className="dl">
      {items.filter((i): i is { label: string; value: ReactNode } => !!i).map((i) => (
        <div key={i.label} className="dl__row">
          <dt>{i.label}</dt>
          <dd>{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

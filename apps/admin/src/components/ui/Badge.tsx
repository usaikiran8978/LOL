import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Status pill. Tone carries meaning visually; the text must carry it too (never colour alone). */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--tone-${tone}`}>{children}</span>;
}

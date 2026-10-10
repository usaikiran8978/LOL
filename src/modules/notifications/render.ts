/** Minimal, safe template rendering: `{{name}}` placeholders only — no logic, no code execution. */
const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]!))];
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function render(text: string, vars: Record<string, string | number>, opts: { html?: boolean } = {}): string {
  return text.replace(TOKEN, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return '';
    const s = String(v);
    return opts.html ? s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!) : s;
  });
}

/** Placeholders used in content but not declared on the template version (caught at publish). */
export function undeclared(contents: Array<{ title?: string | null; subject?: string | null; body: string; htmlBody?: string | null }>, declared: string[]): string[] {
  const used = new Set(contents.flatMap((c) => [c.title, c.subject, c.body, c.htmlBody].filter((x): x is string => !!x).flatMap(placeholders)));
  return [...used].filter((u) => !declared.includes(u));
}

/** Is `now` inside a quiet window [start, end) in the user's timezone? Handles windows crossing midnight. */
export function inQuietHours(now: Date, start: string, end: string, timeZone: string): { quiet: boolean; endsAt: Date | null } {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const [h, m] = fmt.format(now).split(':').map(Number) as [number, number];
  const minutes = h * 60 + m;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const s = toMin(start), e = toMin(end);
  if (s === e) return { quiet: false, endsAt: null };
  const quiet = s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
  if (!quiet) return { quiet: false, endsAt: null };
  const wait = (e - minutes + 24 * 60) % (24 * 60);
  return { quiet: true, endsAt: new Date(now.getTime() + wait * 60_000 - now.getUTCSeconds() * 1000) };
}

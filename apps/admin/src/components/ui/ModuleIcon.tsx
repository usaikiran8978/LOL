/** Line icons for console modules (24px grid, stroke = currentColor). Decorative: always aria-hidden. */
const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  analytics: 'M3 20h18M6 16v-5M11 16V8M16 16v-3M21 16V5',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3',
  moderation: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
  verification: 'M12 2l2.6 2 3.2-.3.9 3.1 2.8 1.6-1.2 3 1.2 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.6-2-3.2.3-.9-3.1-2.8-1.6 1.2-3-1.2-3 2.8-1.6.9-3.1 3.2.3zM8.5 12l2.5 2.5 4.5-5',
  privacy: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  billing: 'M2 6h20v12H2zM2 10h20M6 15h4',
  onboarding: 'M5 3v18M5 4h11l-2 4 2 4H5',
  questionnaire: 'M9 4h10v17H5V8zM9 4v4H5M9 13h6M9 17h6',
  matching: 'M12 21s-8-5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6-8 11-8 11z',
  ai: 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  experiments: 'M9 3h6M10 3v6L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10',
  taxonomy: 'M3 12l9-9h9v9l-9 9zM16 8h.01',
  interests: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
  prompts: 'M4 5h16v11H9l-5 4z',
  countries: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z',
  cities: 'M3 21h18M5 21V8l6-4v17M11 21V10h8v11M8 9v.01M8 13v.01M8 17v.01M15 14v.01M15 18v.01',
  languages: 'M3 5h10M8 3v2M5 9c1.5 3 4 5 7 6M11 5c-1 4-3.5 7-7 9M13 21l4-10 4 10M14.5 18h5',
  flags: 'M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zM16 12h.01',
  segments: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  cms: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4',
  legal: 'M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z',
  notifications: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  events: 'M3 9a2 2 0 0 0 0 4v5h18v-5a2 2 0 0 1 0-4V4H3zM14 4v14',
  dates: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M12 13.5c-1-1.2-3-.6-3 .9 0 1.4 3 3.1 3 3.1s3-1.7 3-3.1c0-1.5-2-2.1-3-.9z',
  admins: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1a7 7 0 0 1 9.5-6.5M18 15v2l1.5 1M18 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  audit: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
};

export function ModuleIcon({ id, size = 22 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[id] ?? PATHS.dashboard} />
    </svg>
  );
}

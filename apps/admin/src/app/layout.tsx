import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { dir, locale, t } from '@/i18n';
import { Providers } from './providers';
import './globals.css';

// Editorial display face (OFL-licensed, self-hosted: no request to Google at build or run time).
const anton = localFont({ src: './fonts/Anton-Regular.ttf', variable: '--font-anton', display: 'swap' });

export const metadata: Metadata = {
  title: t('app.name'),
  // Internal tool: keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={locale} dir={dir} className={anton.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

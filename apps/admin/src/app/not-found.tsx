import Link from 'next/link';
import { t } from '@/i18n';

export default function NotFound() {
  return (
    <main className="centered">
      <div className="state">
        <h1 className="state__title">{t('states.notFoundTitle')}</h1>
        <p>{t('states.notFoundBody')}</p>
        <Link href="/">{t('states.backHome')}</Link>
      </div>
    </main>
  );
}

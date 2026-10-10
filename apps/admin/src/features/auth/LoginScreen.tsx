'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { t } from '@/i18n';
import { safeReturnTo, useSession } from '@/lib/auth/session';

const FEATURE_ICON = { matching: '✦', safety: '⛨', dates: '♥', insights: '▲' } as const;

export function LoginScreen() {
  const session = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const reason = params.get('reason');

  // Already holding a usable session (cookie + CSRF token) → nothing to do here.
  useEffect(() => {
    if (session.status === 'authenticated' && session.hasCsrf) router.replace(returnTo);
  }, [session.status, session.hasCsrf, router, returnTo]);

  return (
    <main className="auth-split">
      <section className="auth-split__brand">
        <span className="auth-split__wordmark">{t('app.name')}<span className="auth-split__wordmark-tagline">{t('app.tagline')}</span></span>

        {/* Decorative product moments (no real member data). */}
        <div className="auth-collage" aria-hidden="true">
          <div className="auth-collage__card auth-collage__card--score">
            <span className="auth-collage__eyebrow">{t('auth.collage.aiMatch')}</span>
            <span className="auth-collage__big">92%</span>
            <span className="auth-collage__label">{t('auth.collage.compatibility')}</span>
            <span className="auth-collage__bar"><span style={{ width: '92%' }} /></span>
          </div>
          <div className="auth-collage__card auth-collage__card--match">
            <span className="auth-collage__avatars"><span>♥</span><span>♥</span></span>
            <span className="auth-collage__big auth-collage__big--sm">{t('auth.collage.match')}</span>
          </div>
          <div className="auth-collage__card auth-collage__card--safety">
            <span className="auth-collage__check">✓</span>
            <span>
              <strong>{t('auth.collage.safetyTitle')}</strong>
              <span className="auth-collage__label">{t('auth.collage.safetyBody')}</span>
            </span>
          </div>
        </div>

        <div>
          <p className="auth-split__headline">{t('auth.brandHeadline')}</p>
          <p className="auth-split__tagline">{t('auth.brandTagline')}</p>
          <ul className="auth-features">
            {(['matching', 'safety', 'dates', 'insights'] as const).map((k) => (
              <li key={k} className="auth-features__item">
                <span className="auth-features__icon" aria-hidden="true">{FEATURE_ICON[k]}</span>
                <span>
                  <strong>{t(`auth.features.${k}.title`)}</strong>
                  <span className="auth-features__body">{t(`auth.features.${k}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <div className="auth-split__form">
        <div className="auth-split__panel">
          <p className="auth-split__eyebrow">{t('auth.consoleEyebrow')}</p>
          <div className="card">
            <h1>{t('auth.title')}</h1>
            <p className="muted auth-split__intro">{t('auth.intro')}</p>
            {reason === 'expired' ? <p className="alert alert--info" role="status">{t('auth.sessionExpired')}</p> : null}
            {reason === 'signedout' ? <p className="alert alert--info" role="status">{t('auth.signedOut')}</p> : null}
            <LoginForm onSubmit={session.login} />
          </div>
          <p className="auth-split__secure">
            <span aria-hidden="true">🔒</span> {t('auth.secureNote')}
          </p>
          <p className="auth-split__footer muted">{t('auth.footer', { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </main>
  );
}

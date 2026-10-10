'use client';

import { uuid } from '@amora/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { validate } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { BillingSection } from './BillingSection';
import { GrantDialog } from './GrantDialog';
import { UserBillingDetails } from './UserBillingDetails';

export function UserBillingPage() {
  return (
    <BillingSection permission="billing.view">
      <UserBillingView />
    </BillingSection>
  );
}

function UserBillingView() {
  const api = useAdminApi();
  const router = useRouter();
  const params = useSearchParams();
  const canGrant = useSession().can('billing.grant');
  const initial = params.get('userId') ?? '';
  const [draft, setDraft] = useState(initial);
  const [draftError, setDraftError] = useState<string | undefined>();
  const [userId, setUserId] = useState(() => (uuid.safeParse(initial).success ? initial : ''));
  const [granting, setGranting] = useState(false);

  const data = useResource(async () => {
    if (!userId) return null;
    const [billing, products] = await Promise.all([api.billing.user(userId), api.billing.products()]);
    // Subscriptions reference products by id; show their keys.
    return { billing, productKeys: new Map(products.map((p) => [p.id, p.key])) };
  }, [api, userId]);

  function lookup() {
    const id = draft.trim();
    const v = validate(uuid, id);
    if (!v.ok) return setDraftError(v.errors[''] ?? t('validation.invalidUuid'));
    setDraftError(undefined);
    setUserId(id);
    router.replace(`/billing/users?userId=${encodeURIComponent(id)}`);
  }

  return (
    <>
      <PageHeader
        title={t('billing.users.title')}
        intro={t('billing.users.intro')}
        actions={canGrant && userId && data.status === 'success' ? <Button onClick={() => setGranting(true)}>{t('billing.users.grant')}</Button> : null}
      />
      <form className="filters" noValidate onSubmit={(e) => { e.preventDefault(); lookup(); }}>
        <TextField
          className="field--inline"
          label={t('billing.users.userId')}
          hint={t('billing.users.userIdHint')}
          value={draft}
          onChange={setDraft}
          error={draftError}
          required
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit">{t('billing.users.lookup')}</Button>
      </form>
      {!userId ? <EmptyState message={t('billing.users.prompt')} /> : null}
      {userId && data.status === 'loading' ? <LoadingState /> : null}
      {userId && data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {userId && data.status === 'success' && data.data ? (
        <UserBillingDetails data={data.data.billing} productKeys={data.data.productKeys} onChanged={data.reload} />
      ) : null}
      {granting && userId ? <GrantDialog userId={userId} onClose={() => setGranting(false)} onDone={data.reload} /> : null}
    </>
  );
}

'use client';

import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { CursorList } from '@/lib/hooks/useCursorList';
import { Button } from './Button';
import { FormError } from './states';

/** Footer for cursor lists: load-more button, inline error for the failed page, end-of-list marker. */
export function LoadMore({ list }: { list: Pick<CursorList<unknown>, 'hasMore' | 'moreBusy' | 'moreError' | 'loadMore'> }) {
  return (
    <>
      {list.moreError ? <FormError message={errorMessage(list.moreError)} requestId={requestIdOf(list.moreError)} /> : null}
      <div className="row pager">
        {list.hasMore ? (
          <Button variant="secondary" onClick={() => void list.loadMore()} disabled={list.moreBusy}>{list.moreBusy ? t('common.loadingMore') : t('common.loadMore')}</Button>
        ) : (
          <span className="muted">{t('common.endOfList')}</span>
        )}
      </div>
    </>
  );
}

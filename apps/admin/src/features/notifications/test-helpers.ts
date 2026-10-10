import type { RecordedCall } from '@/test/utils';

/** Non-GET calls made by the page under test (the sign-in POST from renderSignedIn is excluded). */
export const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/admin/auth'));

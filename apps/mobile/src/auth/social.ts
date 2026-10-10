import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

export type SocialProvider = 'google' | 'apple';

export interface PendingSocialSignup {
  provider: SocialProvider;
  idToken: string;
  nonce?: string;
}

// The ID token is a credential: it is held in memory only (never in route params, storage or logs) between the
// "needs sign-up details" response and the sign-up form.
let pending: PendingSocialSignup | null = null;
export const setPendingSocial = (p: PendingSocialSignup | null) => {
  pending = p;
};
export const getPendingSocial = () => pending;

// Providers the server reported as not configured during this app session.
const unconfigured = new Set<SocialProvider>();
export const markProviderUnavailable = (p: SocialProvider) => unconfigured.add(p);
export const isProviderMarkedUnavailable = (p: SocialProvider) => unconfigured.has(p);

export const newNonce = () => Crypto.randomUUID();

/**
 * Native Sign in with Apple. Apple embeds SHA-256(nonce) in the token; the API hashes the raw nonce we send and
 * compares, which binds the token to this request.
 */
export async function appleSignIn(): Promise<{ idToken: string; nonce: string } | null> {
  const nonce = newNonce();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    return cred.identityToken ? { idToken: cred.identityToken, nonce } : null;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

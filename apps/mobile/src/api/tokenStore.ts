import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@amora/shared';

/**
 * Access token lives only in memory (short-lived, never persisted); the refresh token is persisted in the platform
 * keychain/keystore so the session survives restarts. Nothing token-related ever touches AsyncStorage or logs.
 */
export interface TokenStore {
  getAccess(): { token: string; expiresAt: number } | null;
  getRefresh(): Promise<string | null>;
  setTokens(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

const REFRESH_KEY = 'amora.refreshToken';

export class SecureTokenStore implements TokenStore {
  private access: { token: string; expiresAt: number } | null = null;
  // undefined = not read from the keychain yet
  private refresh: string | null | undefined;

  getAccess() {
    return this.access;
  }

  async getRefresh(): Promise<string | null> {
    if (this.refresh === undefined) this.refresh = await SecureStore.getItemAsync(REFRESH_KEY);
    return this.refresh;
  }

  async setTokens(t: AuthTokens): Promise<void> {
    // Memory first: concurrent requests waiting on the refresh must see the new pair immediately.
    this.access = { token: t.accessToken, expiresAt: Date.parse(t.accessTokenExpiresAt) };
    this.refresh = t.refreshToken;
    await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }

  async clear(): Promise<void> {
    this.access = null;
    this.refresh = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}

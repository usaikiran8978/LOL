import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DeviceInfo } from '@amora/shared';
import { env } from '../config/env';

const INSTALLATION_KEY = 'amora.installationId';
let installation: Promise<string> | null = null;

/** Stable per-install identifier: generated once, persisted, sent with every sign-in so sessions map to devices. */
export function getInstallationId(): Promise<string> {
  installation ??= (async () => {
    const existing = await SecureStore.getItemAsync(INSTALLATION_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(INSTALLATION_KEY, id);
    return id;
  })().catch((e) => {
    installation = null; // allow a retry after a transient keychain failure
    throw e;
  });
  return installation;
}

export function platformName(): DeviceInfo['platform'] {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
}

const clip = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : undefined);

/** `deviceInfo` payload required by every sign-in endpoint (shared contract `deviceInfo`). */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  return {
    installationId: await getInstallationId(),
    platform: platformName(),
    model: clip(Device.modelName, 100),
    osVersion: clip(Device.osVersion, 50),
    appVersion: clip(Application.nativeApplicationVersion ?? env.appVersion, 50),
  };
}

/** For tests: forget the memoized id. */
export function resetInstallationCache(): void {
  installation = null;
}

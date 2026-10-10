import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getInstallationId } from '../auth/device';
import { notificationsApi } from '../api/notifications';

export type PushRegistration = 'registered' | 'denied' | 'unsupported';

/**
 * Registers this device's native push token with the API. The server sends through FCM / APNs directly (it does not
 * use the Expo push service), so the raw device token is required — never an Expo push token.
 * `prompt` controls whether the OS permission dialog may be shown (only after an explicit user action).
 */
export async function registerForPush({ prompt }: { prompt: boolean }): Promise<PushRegistration> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && prompt && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return 'denied';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.DEFAULT }).catch(() => undefined);
  }
  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== 'string' || token.data.length < 10) return 'unsupported';
  await notificationsApi.registerPushToken({ installationId: await getInstallationId(), provider: Platform.OS === 'ios' ? 'apns' : 'fcm', token: token.data });
  return 'registered';
}

/** Current OS permission without prompting. */
export async function pushPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

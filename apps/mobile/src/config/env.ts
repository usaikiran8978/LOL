import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * Build-time configuration. EXPO_PUBLIC_* variables are inlined by the bundler, so per-environment builds set them in
 * EAS / CI; app.json `extra` holds local-development defaults.
 */
export const env = {
  apiUrl: str(process.env.EXPO_PUBLIC_API_URL) ?? str(extra.apiUrl) ?? 'http://localhost:3000',
  google: {
    iosClientId: str(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    androidClientId: str(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
    webClientId: str(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  },
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;

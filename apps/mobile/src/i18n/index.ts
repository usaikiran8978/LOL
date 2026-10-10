import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import ar from './locales/ar.json';
import en from './locales/en.json';

/** Bundled UI languages. Server-managed content (taxonomy, CMS, legal) is localized by the API independently. */
export const resources = { en: { translation: en }, ar: { translation: ar } } as const;
export type AppLanguage = keyof typeof resources;
export const APP_LANGUAGES = Object.keys(resources) as AppLanguage[];

const RTL = new Set(['ar', 'fa', 'he', 'ur']);
const STORAGE_KEY = 'amora.language';

export const isRtlLanguage = (lang: string) => RTL.has(lang.split('-')[0]!);
const supported = (lang: string | null | undefined): lang is AppLanguage => !!lang && (APP_LANGUAGES as string[]).includes(lang);

export function detectLanguage(): AppLanguage {
  for (const l of getLocales()) if (supported(l.languageCode)) return l.languageCode;
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  // React already escapes text; double escaping would show entities.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * Layout direction only switches after a reload in React Native. Returns true when the caller should ask the user to
 * restart the app.
 */
export function applyDirection(lang: string): boolean {
  const rtl = isRtlLanguage(lang);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

export async function changeLanguage(lang: AppLanguage): Promise<boolean> {
  await i18n.changeLanguage(lang);
  await SecureStore.setItemAsync(STORAGE_KEY, lang).catch(() => undefined);
  return applyDirection(lang);
}

/** Restores an explicit in-app language choice; otherwise keeps the device language. */
export async function restoreLanguage(): Promise<void> {
  const saved = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
  const lang = supported(saved) ? saved : detectLanguage();
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
  applyDirection(lang);
}

export default i18n;

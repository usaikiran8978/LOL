import { useTranslation } from 'react-i18next';
import { APP_LANGUAGES, changeLanguage, type AppLanguage } from '../../i18n';
import { Notice, Screen, Select, useToast } from '../../components';
import { useConfig } from '../../config/ConfigProvider';
import { languageName } from '../../i18n/format';
import { useState } from 'react';

/** UI language. Offered: languages bundled in the app that the server also lists as app locales (when known). */
export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { config } = useConfig();
  const [restart, setRestart] = useState(false);
  const serverLocales = config?.locales.map((l) => l.code);
  const available = APP_LANGUAGES.filter((l) => !serverLocales?.length || serverLocales.includes(l) || l === 'en');
  const nativeName = (code: string) => config?.locales.find((l) => l.code === code)?.nativeName ?? languageName(code);

  return (
    <Screen title={t('settings.language')} testID="language-screen">
      {restart ? <Notice tone="warning" title={t('settings.restartRequired')} testID="restart-notice" /> : null}
      <Select
        testID="language-select"
        label={t('settings.appLanguage')}
        value={i18n.language}
        options={available.map((l) => ({ value: l, label: nativeName(l) }))}
        onChange={async (v) => {
          const needsRestart = await changeLanguage(v as AppLanguage);
          setRestart(needsRestart);
          toast.show(t('settings.languageChanged'), 'success');
        }}
      />
    </Screen>
  );
}

import { adminTermUpsert } from '@amora/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { scopedErrors, validate } from '@/lib/forms/validate';
import { TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues } from './TranslationEditor';

const FIELDS: TranslationFieldSpec<'label' | 'description'>[] = [
  { name: 'label', labelKey: 'taxonomy.fields.label' },
  { name: 'description', labelKey: 'taxonomy.fields.description', optional: true },
];

function Harness({ initial }: { initial: TranslationValues<'label' | 'description'> }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TranslationEditor fields={FIELDS} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('translation editor', () => {
  it('the shared contract requires an en translation', () => {
    const r = validate(adminTermUpsert, { kind: 'pets', key: 'dog', translations: { fr: { label: 'Chien' } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(scopedErrors(r.errors, 'translations')['']).toBe(t('validation.enRequired'));
  });

  it('flags a missing en entry', () => {
    render(<Harness initial={{ fr: { label: 'Chien', description: '' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(t('translations.missingEn'));
  });

  it('adds and removes locales but never en', async () => {
    const user = userEvent.setup();
    render(<Harness initial={translationsFromServer(FIELDS, { en: { label: 'Dog', description: null } })} />);
    expect(screen.queryByRole('button', { name: t('translations.removeLocale', { locale: 'en' }) })).toBeNull();
    expect(screen.getByText(t('translations.enLocked'))).toBeInTheDocument();

    await user.type(screen.getByLabelText(t('translations.addLocaleLabel')), 'not a locale');
    await user.click(screen.getByRole('button', { name: t('translations.addLocale') }));
    expect(screen.getByText(t('translations.localeInvalid'))).toBeInTheDocument();

    await user.clear(screen.getByLabelText(t('translations.addLocaleLabel')));
    await user.type(screen.getByLabelText(t('translations.addLocaleLabel')), 'pt-BR{Enter}');
    expect(screen.getByRole('tab', { name: 'pt-BR' })).toHaveAttribute('aria-selected', 'true');
    await user.type(screen.getByLabelText(`${t("taxonomy.fields.label")} (pt-BR)`, { exact: false }), 'Cachorro');
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toMatchObject({ 'pt-BR': { label: 'Cachorro' } });

    await user.click(screen.getByRole('button', { name: t('translations.removeLocale', { locale: 'pt-BR' }) }));
    expect(screen.queryByRole('tab', { name: 'pt-BR' })).toBeNull();
  });

  it('omits blank optional fields from the payload', () => {
    expect(translationsToPayload(FIELDS, { en: { label: 'Dog', description: '  ' } })).toEqual({ en: { label: 'Dog' } });
  });
});

import type { TaxonomyKind } from '@amora/shared';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { catalogApi, type Term } from '../api';
import { useResource } from '../hooks/useResource';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { ChipGroup } from './Chip';
import { Select } from './Select';
import { Text } from './Text';

export interface TermPickerProps {
  kind: TaxonomyKind;
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  max?: number;
  hint?: string;
  error?: string | null;
  /** Pre-fetched terms (several pickers on one screen share one catalog request). */
  terms?: Term[];
  testID?: string;
}

// Short lists read best as chips; long single-choice lists (e.g. religions, zodiac) use the modal picker.
const CHIP_LIMIT = 12;

/** Picker for admin-managed taxonomy terms. Labels come localized from the API; nothing is hard-coded. */
export function TermPicker({ kind, terms, ...rest }: TermPickerProps) {
  const { i18n } = useTranslation();
  const res = useResource(() => catalogApi.taxonomy([kind]), [kind, i18n.language], !terms);
  if (terms) return <TermPickerView {...rest} terms={terms.filter((x) => x.kind === kind)} />;
  return <TermPickerView {...rest} terms={res.data} loading={res.status === 'loading'} failed={res.status === 'error'} onRetry={res.reload} />;
}

function TermPickerView({
  label, value, onChange, multiple, max, hint, error, terms, loading, failed, onRetry, testID,
}: Omit<TermPickerProps, 'kind' | 'terms'> & { terms?: Term[]; loading?: boolean; failed?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  if (loading && !terms) {
    return (
      <View style={{ marginBottom: spacing.lg }} accessible accessibilityLabel={t('common.loading')}>
        <Text variant="label">{label}</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
      </View>
    );
  }
  if (failed && !terms) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="label">{label}</Text>
        <Text color="danger" accessibilityRole="alert">
          {t('common.loadFailed')}
        </Text>
        {onRetry ? <Button label={t('common.retry')} variant="ghost" onPress={onRetry} /> : null}
      </View>
    );
  }
  const options = (terms ?? []).map((x) => ({ value: x.id, label: x.label, description: x.description ?? undefined }));
  if (!multiple && options.length > CHIP_LIMIT) {
    return <Select label={label} value={value[0] ?? null} options={options} onChange={(v) => onChange([v])} searchable error={error} testID={testID} />;
  }
  return <ChipGroup label={label} options={options} selected={value} onChange={onChange} multiple={multiple} max={max} hint={hint} error={error} testID={testID} />;
}

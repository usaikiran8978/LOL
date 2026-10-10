import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { TextField } from './TextField';

export interface DateFieldProps {
  label: string;
  /** ISO YYYY-MM-DD or '' */
  value: string;
  onChange: (iso: string) => void;
  error?: string | null;
  hint?: string;
  testID?: string;
}

/** Returns YYYY-MM-DD when the parts form a real calendar date, else ''. */
export function toIsoDate(day: string, month: string, year: string): string {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || year.length !== 4) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Date of birth entry as three numeric fields. Typing is faster and more accessible than a wheel picker for dates
 * decades in the past, and it needs no native module.
 */
export function DateField({ label, value, onChange, error, hint, testID }: DateFieldProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [y0, m0, d0] = value ? value.split('-') : ['', '', ''];
  const [parts, setParts] = useState({ day: d0 ?? '', month: m0 ?? '', year: y0 ?? '' });

  const update = (k: 'day' | 'month' | 'year', v: string) => {
    const next = { ...parts, [k]: v.replace(/\D/g, '') };
    setParts(next);
    onChange(toIsoDate(next.day, next.month, next.year));
  };

  return (
    <View accessibilityRole="none" style={{ marginBottom: spacing.sm }}>
      <Text variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <View style={styles.small}>
          <TextField label={t('common.day')} value={parts.day} onChangeText={(v) => update('day', v)} keyboardType="number-pad" maxLength={2} testID={testID ? `${testID}-day` : undefined} />
        </View>
        <View style={styles.small}>
          <TextField label={t('common.month')} value={parts.month} onChangeText={(v) => update('month', v)} keyboardType="number-pad" maxLength={2} testID={testID ? `${testID}-month` : undefined} />
        </View>
        <View style={styles.large}>
          <TextField label={t('common.year')} value={parts.year} onChangeText={(v) => update('year', v)} keyboardType="number-pad" maxLength={4} testID={testID ? `${testID}-year` : undefined} />
        </View>
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  small: { flex: 1 },
  large: { flex: 1.6 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface NoticeProps {
  title: string;
  body?: string;
  tone?: 'info' | 'warning' | 'danger' | 'success';
  testID?: string;
}

const ICONS = { info: 'information-circle', warning: 'warning', danger: 'alert-circle', success: 'checkmark-circle' } as const;

/** Inline callout. Also used to mark features that the API does not support yet ("coming soon"). */
export function Notice({ title, body, tone = 'info', testID }: NoticeProps) {
  const { colors, radius, spacing } = useTheme();
  const bg = { info: colors.primarySoft, warning: colors.warningSoft, danger: colors.dangerSoft, success: colors.successSoft }[tone];
  const fg = ({ info: 'primary', warning: 'warning', danger: 'danger', success: 'success' } as const)[tone];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={{ flexDirection: 'row', gap: spacing.sm, backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, borderStartWidth: 4, borderStartColor: colors[fg] }}
    >
      <Ionicons name={ICONS[tone]} size={20} color={colors[fg]} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text variant="label" color={fg}>
          {title}
        </Text>
        {body ? <Text variant="caption" color="text" style={{ marginTop: spacing.xs }}>{body}</Text> : null}
      </View>
    </View>
  );
}

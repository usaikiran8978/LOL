import { useRef, useState, type MutableRefObject } from 'react';
import { I18nManager, PanResponder, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

export interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  low: number;
  /** Omit for a single-value slider. */
  high?: number;
  onChange: (low: number, high: number | undefined) => void;
  format: (v: number) => string;
  lowLabel: string;
  highLabel?: string;
  testID?: string;
}

const THUMB = 28;

/**
 * Single or dual-thumb slider. Each thumb is an `adjustable` element, so VoiceOver/TalkBack users change it with
 * swipe up/down (increment/decrement actions) instead of dragging.
 */
export function RangeSlider({ label, min, max, step = 1, low, high, onChange, format, lowLabel, highLabel, testID }: RangeSliderProps) {
  const { colors, spacing } = useTheme();
  const [width, setWidth] = useState(0);
  const latest = useRef({ low, high, width, min, max, step, onChange });
  latest.current = { low, high, width, min, max, step, onChange };

  const pct = (v: number) => (max === min ? 0 : (v - min) / (max - min));
  const summary = high === undefined ? format(low) : `${format(low)} – ${format(high)}`;

  const set = (which: 'low' | 'high', raw: number) => {
    const s = latest.current;
    const snapped = Math.round(raw / s.step) * s.step;
    if (which === 'low') {
      const ceiling = s.high === undefined ? s.max : s.high;
      s.onChange(Math.max(s.min, Math.min(ceiling, snapped)), s.high);
    } else if (s.high !== undefined) {
      s.onChange(s.low, Math.min(s.max, Math.max(s.low, snapped)));
    }
  };

  return (
    <View style={{ marginBottom: spacing.xl }} testID={testID}>
      <View style={styles.header}>
        <Text variant="label">{label}</Text>
        <Text variant="label" color="primary">
          {summary}
        </Text>
      </View>
      <View style={[styles.track, { marginHorizontal: THUMB / 2 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.rail, { backgroundColor: colors.surfaceAlt }]} />
        <View
          style={[
            styles.rail,
            { backgroundColor: colors.primary, start: high === undefined ? 0 : pct(low) * width, width: ((high === undefined ? pct(low) : pct(high) - pct(low)) * width) || 0 },
          ]}
        />
        <Thumb which="low" value={low} label={lowLabel} offset={pct(low) * width} {...{ min, max: high ?? max, step, format, set, latest, testID }} />
        {high !== undefined ? <Thumb which="high" value={high} label={highLabel ?? lowLabel} offset={pct(high) * width} {...{ min: low, max, step, format, set, latest, testID }} /> : null}
      </View>
    </View>
  );
}

interface ThumbProps {
  which: 'low' | 'high';
  value: number;
  label: string;
  offset: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  set: (which: 'low' | 'high', v: number) => void;
  latest: MutableRefObject<{ low: number; high?: number; width: number; min: number; max: number }>;
  testID?: string;
}

function Thumb({ which, value, label, offset, min, max, step, format, set, latest, testID }: ThumbProps) {
  const { colors } = useTheme();
  const start = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const s = latest.current;
        start.current = which === 'low' ? s.low : (s.high ?? s.low);
      },
      onPanResponderMove: (_, g) => {
        const s = latest.current;
        if (!s.width) return;
        // Positions are laid out from the start edge, so in RTL a rightward drag decreases the value.
        const dx = I18nManager.isRTL ? -g.dx : g.dx;
        set(which, start.current + (dx / s.width) * (s.max - s.min));
      },
    }),
  ).current;

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') set(which, value + step);
    if (e.nativeEvent.actionName === 'decrement') set(which, value - step);
  };

  return (
    <View
      {...pan.panHandlers}
      testID={testID ? `${testID}-${which}` : undefined}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      hitSlop={(MIN_TOUCH - THUMB) / 2 + 4}
      style={[styles.thumb, { start: offset - THUMB / 2, backgroundColor: colors.background, borderColor: colors.primary }]}
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  track: { height: MIN_TOUCH, justifyContent: 'center' },
  rail: { position: 'absolute', height: 6, borderRadius: 3, start: 0, end: 0 },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3 },
});

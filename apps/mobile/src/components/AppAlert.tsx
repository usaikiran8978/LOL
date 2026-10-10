import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { CONTROL_HEIGHT, elevation } from '../theme/tokens';
import { Text } from './Text';

export interface AppAlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}
interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons?: AppAlertButton[];
}

let present: ((r: Omit<AlertRequest, 'id'>) => void) | null = null;

/**
 * Drop-in replacement for `Alert.alert(title, message, buttons)` rendered as a branded dialog by <AlertHost />.
 * Without a mounted host (e.g. isolated unit tests) it falls back to the native alert.
 */
export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]): void {
  if (present) present({ title, message, buttons });
  else Alert.alert(title, message, buttons);
}

/** Mount once near the root. Shows queued alerts one at a time. */
export function AlertHost() {
  const [queue, setQueue] = useState<AlertRequest[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    present = (r) => {
      seq.current += 1;
      const id = seq.current;
      setQueue((q) => [...q, { ...r, id }]);
    };
    return () => {
      present = null;
    };
  }, []);
  const current = queue[0];
  const close = useCallback(() => setQueue((q) => q.slice(1)), []);
  return current ? <AlertDialog key={current.id} request={current} onClose={close} /> : null;
}

function AlertDialog({ request, onClose }: { request: AlertRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [appear]);

  const buttons: AppAlertButton[] = request.buttons?.length ? request.buttons : [{ text: t('common.ok') }];
  const destructive = buttons.some((b) => b.style === 'destructive');
  const cancel = buttons.find((b) => b.style === 'cancel');
  const press = (b?: AppAlertButton) => {
    onClose();
    b?.onPress?.();
  };
  // Primary actions first (thumb reach), cancel last.
  const ordered = [...buttons.filter((b) => b.style !== 'cancel'), ...buttons.filter((b) => b.style === 'cancel')];

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => press(cancel)} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }]}>
        <Animated.View
          testID="app-alert"
          accessibilityViewIsModal
          style={[
            elevation.raised,
            {
              width: '100%',
              maxWidth: 380,
              backgroundColor: colors.surface,
              borderRadius: radius.xl,
              padding: spacing.xl,
              opacity: appear,
              transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
            },
          ]}
        >
          <View style={{ width: 52, height: 52, borderRadius: 26, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: destructive ? colors.dangerSoft : colors.primarySoft, marginBottom: spacing.md }}>
            <Ionicons name={destructive ? 'alert-circle' : 'heart'} size={28} color={destructive ? colors.danger : colors.accent} />
          </View>
          <Text variant="title" align="center" accessibilityRole="header">
            {request.title}
          </Text>
          {request.message ? (
            <Text color="textMuted" align="center" style={{ marginTop: spacing.sm }}>
              {request.message}
            </Text>
          ) : null}
          <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
            {ordered.map((b, i) => {
              const kind = b.style === 'destructive' ? 'destructive' : b.style === 'cancel' ? 'cancel' : 'default';
              const label = b.text ?? t('common.ok');
              return (
                <Pressable
                  key={`${label}-${i}`}
                  testID={`app-alert-${kind}`}
                  onPress={() => press(b)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => ({
                    minHeight: CONTROL_HEIGHT,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    opacity: pressed ? 0.85 : 1,
                    backgroundColor: kind === 'destructive' ? colors.danger : 'transparent',
                    borderWidth: kind === 'cancel' ? 1.5 : 0,
                    borderColor: colors.border,
                  })}
                >
                  {kind === 'default' ? <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
                  <Text variant="label" style={{ fontSize: 16, fontWeight: '700' }} color={kind === 'destructive' ? 'onDanger' : kind === 'cancel' ? 'text' : 'onGradient'}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

type Tone = 'info' | 'success' | 'error';
interface ToastMsg {
  id: number;
  text: string;
  tone: Tone;
}
interface ToastApi {
  show: (text: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);

const DURATION_MS = 4000;

/** Transient confirmation/error messages, announced to screen readers and dismissible by tap. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const seq = useRef(0);
  const show = useCallback((text: string, tone: Tone = 'info') => {
    seq.current += 1;
    setMsg({ id: seq.current, text, tone });
    AccessibilityInfo.announceForAccessibility(text);
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg((m) => (m?.id === msg.id ? null : m)), DURATION_MS);
    return () => clearTimeout(id);
  }, [msg]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {msg ? <ToastView msg={msg} onDismiss={() => setMsg(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ msg, onDismiss }: { msg: ToastMsg; onDismiss: () => void }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 8, tension: 70 }).start();
  }, [enter, msg.id]);
  const tone = {
    info: { accent: colors.primary, soft: colors.primarySoft, icon: 'heart' as const },
    success: { accent: colors.success, soft: colors.successSoft, icon: 'checkmark-circle' as const },
    error: { accent: colors.danger, soft: colors.dangerSoft, icon: 'alert-circle' as const },
  }[msg.tone];
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-start', paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.sm }]}>
      <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] }}>
        <Pressable
          testID="toast"
          onPress={onDismiss}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={msg.text}
          accessibilityHint={t('common.dismiss')}
          style={[
            elevation.raised,
            { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, paddingStart: spacing.md + 4, minHeight: MIN_TOUCH, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
          ]}
        >
          <View style={{ position: 'absolute', start: 0, top: 0, bottom: 0, width: 4, backgroundColor: tone.accent }} />
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: tone.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={tone.icon} size={18} color={msg.tone === 'info' ? colors.accent : tone.accent} />
          </View>
          <Text variant="label" style={{ flex: 1 }}>
            {msg.text}
          </Text>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

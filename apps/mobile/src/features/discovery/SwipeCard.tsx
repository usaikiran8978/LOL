import { useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';

export type SwipeAction = 'like' | 'pass';

const THRESHOLD = 110;
const FLING_VELOCITY = 0.8;
const OFFSCREEN = 600;

/**
 * Drag right to like, left to pass. `onSwipe` resolves true when the card was consumed (the parent then unmounts it —
 * key it by profile id); false (e.g. a paywall) springs it back. Screen-reader users get the same actions through
 * accessibilityActions, and callers should still render explicit buttons.
 */
export function SwipeCard({
  children,
  onSwipe,
  disabled,
  likeLabel,
  passLabel,
  testID,
}: {
  children: ReactNode;
  onSwipe: (action: SwipeAction) => Promise<boolean>;
  disabled?: boolean;
  likeLabel: string;
  passLabel: string;
  testID?: string;
}) {
  const { colors, radius, spacing } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const springBack = () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
  const fling = (action: SwipeAction) =>
    Animated.timing(x, { toValue: action === 'like' ? OFFSCREEN : -OFFSCREEN, duration: 180, useNativeDriver: false }).start(async () => {
      if (!(await onSwipeRef.current(action))) springBack();
    });

  const pan = useRef(
    PanResponder.create({
      // Claim only clearly horizontal drags so the surrounding ScrollView keeps vertical scrolling.
      onMoveShouldSetPanResponder: (_, g) => !disabledRef.current && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        const flung = Math.abs(g.vx) > FLING_VELOCITY && Math.abs(g.dx) > 40;
        if (Math.abs(g.dx) > THRESHOLD || flung) fling(g.dx > 0 ? 'like' : 'pass');
        else springBack();
      },
      onPanResponderTerminate: springBack,
    }),
  ).current;

  const rotate = x.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-10deg', '0deg', '10deg'] });
  const likeOpacity = x.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = x.interpolate({ inputRange: [-THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const stamp = { borderWidth: 3, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, backgroundColor: colors.surface };

  return (
    <Animated.View
      testID={testID}
      {...pan.panHandlers}
      accessibilityActions={[
        { name: 'like', label: likeLabel },
        { name: 'pass', label: passLabel },
      ]}
      onAccessibilityAction={(e) => {
        if (!disabled && (e.nativeEvent.actionName === 'like' || e.nativeEvent.actionName === 'pass')) void onSwipe(e.nativeEvent.actionName);
      }}
      style={{ transform: [{ translateX: x }, { rotate }] }}
    >
      {children}
      <Animated.View pointerEvents="none" style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]}>
        <View style={[stamp, { borderColor: colors.success }]}>
          <Text variant="heading" style={{ color: colors.accentText }}>
            {likeLabel.toUpperCase()}
          </Text>
        </View>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.stamp, styles.passStamp, { opacity: passOpacity }]}>
        <View style={[stamp, { borderColor: colors.danger }]}>
          <Text variant="heading" style={{ color: colors.primary }}>
            {passLabel.toUpperCase()}
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stamp: { position: 'absolute', top: 24 },
  likeStamp: { left: 24, transform: [{ rotate: '-12deg' }] },
  passStamp: { right: 24, transform: [{ rotate: '12deg' }] },
});

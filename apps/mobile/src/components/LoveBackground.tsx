import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { IconName } from './IconButton';

type Direction = 'up' | 'down' | 'left' | 'right' | 'upRight' | 'downLeft';

interface Particle {
  icon: IconName;
  /** 0..1 position across the axis perpendicular to travel. */
  lane: number;
  dir: Direction;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  spin: number;
  tint: 'primary' | 'gradientEnd' | 'superLike' | 'sparkle';
}

// Fixed layout (no Math.random) so every screen looks the same and renders deterministically.
const PARTICLES: Particle[] = [
  { icon: 'heart', lane: 0.08, dir: 'up', size: 25, duration: 14000, delay: 0, opacity: 0.28, spin: 20, tint: 'primary' },
  { icon: 'star', lane: 0.3, dir: 'down', size: 17, duration: 17000, delay: 1250, opacity: 0.28, spin: 180, tint: 'sparkle' },
  { icon: 'heart-outline', lane: 0.55, dir: 'up', size: 34, duration: 19000, delay: 2500, opacity: 0.23, spin: -25, tint: 'gradientEnd' },
  { icon: 'sparkles', lane: 0.82, dir: 'up', size: 20, duration: 13000, delay: 600, opacity: 0.3, spin: 0, tint: 'sparkle' },
  { icon: 'heart', lane: 0.18, dir: 'right', size: 20, duration: 21000, delay: 1750, opacity: 0.23, spin: 15, tint: 'gradientEnd' },
  { icon: 'flower-outline', lane: 0.62, dir: 'left', size: 25, duration: 23000, delay: 400, opacity: 0.2, spin: 120, tint: 'primary' },
  { icon: 'star-outline', lane: 0.42, dir: 'right', size: 17, duration: 18000, delay: 3500, opacity: 0.25, spin: -160, tint: 'superLike' },
  { icon: 'heart-half', lane: 0.88, dir: 'left', size: 22, duration: 20000, delay: 2100, opacity: 0.23, spin: -20, tint: 'primary' },
  { icon: 'heart', lane: 0.7, dir: 'down', size: 14, duration: 15000, delay: 3000, opacity: 0.28, spin: 30, tint: 'primary' },
  { icon: 'sparkles-outline', lane: 0.12, dir: 'upRight', size: 22, duration: 22000, delay: 1000, opacity: 0.23, spin: 45, tint: 'sparkle' },
  { icon: 'rose-outline', lane: 0.5, dir: 'downLeft', size: 28, duration: 24000, delay: 4500, opacity: 0.19, spin: -40, tint: 'gradientEnd' },
  { icon: 'heart-circle-outline', lane: 0.95, dir: 'up', size: 28, duration: 16000, delay: 4000, opacity: 0.2, spin: 15, tint: 'primary' },
  { icon: 'star', lane: 0.25, dir: 'left', size: 13, duration: 19000, delay: 5250, opacity: 0.3, spin: 200, tint: 'sparkle' },
  { icon: 'balloon-outline', lane: 0.38, dir: 'up', size: 25, duration: 26000, delay: 5500, opacity: 0.18, spin: 10, tint: 'superLike' },
  { icon: 'heart', lane: 0.78, dir: 'upRight', size: 18, duration: 18000, delay: 6250, opacity: 0.25, spin: -30, tint: 'gradientEnd' },
];

/** Start / end points (in px) for a particle crossing the screen in its direction, with a margin so it enters and exits off-screen. */
function path(p: Particle, w: number, h: number) {
  const m = 40;
  const x = p.lane * w;
  const y = p.lane * h;
  switch (p.dir) {
    case 'up':
      return { from: { x, y: h + m }, to: { x: x + 30, y: -m } };
    case 'down':
      return { from: { x, y: -m }, to: { x: x - 30, y: h + m } };
    case 'right':
      return { from: { x: -m, y }, to: { x: w + m, y: y - 40 } };
    case 'left':
      return { from: { x: w + m, y }, to: { x: -m, y: y + 40 } };
    case 'upRight':
      return { from: { x: x * 0.5, y: h + m }, to: { x: w * 0.6 + x * 0.4, y: -m } };
    case 'downLeft':
      return { from: { x: w * 0.5 + x * 0.5, y: -m }, to: { x: x * 0.4, y: h + m } };
  }
}

function FloatingParticle({ p, width, height, color }: { p: Particle; width: number; height: number; color: string }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([Animated.delay(p.delay), Animated.timing(t, { toValue: 1, duration: p.duration, easing: Easing.linear, useNativeDriver: true }), Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true })]));
    anim.start();
    return () => anim.stop();
  }, [t, p.delay, p.duration]);

  const { from, to } = path(p, width, height);
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [from.y, to.y] });
  const opacity = t.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, p.opacity, p.opacity, 0] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] });
  // Gentle side-to-side sway on top of the straight path.
  const sway = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 8, 0, -8, 0] });

  return (
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, opacity, transform: [{ translateX }, { translateY }, { translateX: sway }, { rotate }] }}>
      <Ionicons name={p.icon} size={p.size} color={color} />
    </Animated.View>
  );
}

/**
 * Decorative layer of drifting hearts, stars and sparkles behind screen content. Purely visual: hidden from assistive
 * tech, never intercepts touches, and switched off when the system "Reduce motion" setting is on.
 */
export function LoveBackground({ tint }: { tint?: string }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduceMotion(v))
      .catch(() => alive && setReduceMotion(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  if (reduceMotion || !width || !height) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {PARTICLES.map((p, i) => (
        <FloatingParticle key={i} p={p} width={width} height={height} color={tint ?? colors[p.tint]} />
      ))}
    </View>
  );
}

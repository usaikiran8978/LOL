import Svg, { Text as SvgText } from 'react-native-svg';
import { fonts } from '../theme/tokens';

/** Large outlined numeral (editorial age / score). Decorative: callers must expose the value in accessible text. */
export function OutlinedNumeral({ value, size = 120, color = '#FFFFFF', strokeWidth = 1.5, opacity = 0.9 }: { value: string; size?: number; color?: string; strokeWidth?: number; opacity?: number }) {
  const width = Math.ceil(size * 0.58 * value.length) + strokeWidth * 2;
  const height = Math.ceil(size * 1.05);
  return (
    <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <SvgText x={width - strokeWidth} y={size * 0.92} textAnchor="end" fontFamily={fonts.display} fontSize={size} fill="none" stroke={color} strokeWidth={strokeWidth} opacity={opacity}>
        {value}
      </SvgText>
    </Svg>
  );
}

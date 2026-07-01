import { useEffect, useMemo } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import styled, { useTheme } from "styled-components/native";

type MovieLoaderProps = {
  size?: number;
  label?: string;
  /** Overrides the dot tint. Defaults to the active theme's primary (app green). */
  color?: string;
};

// "Sandy loading" style: a ring of dots with a comet-like trailing fade + taper.
// The dot pattern is static; only the container is rotated (a single UI-thread
// transform), so this stays extremely cheap even when several loaders mount.
const DOT_COUNT = 12;
const SPIN_DURATION_MS = 1000;

const Root = styled.View`
  align-items: center;
  justify-content: center;
`;

const Label = styled.Text`
  margin-top: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 11px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
`;

export function MovieLoader({ size = 44, label, color }: MovieLoaderProps) {
  const currentTheme = useTheme();
  const tint = color ?? currentTheme.colors.primary;
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, { duration: SPIN_DURATION_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(spin);
  }, [spin]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  const dots = useMemo(() => {
    const center = size / 2;
    const headRadius = Math.max(1.6, size * 0.082);
    const tailRadius = Math.max(1, size * 0.032);
    const orbit = center - headRadius - 1;

    return Array.from({ length: DOT_COUNT }, (_, index) => {
      const progress = index / (DOT_COUNT - 1); // 0 = tail, 1 = head
      const angle = (index / DOT_COUNT) * 2 * Math.PI - Math.PI / 2;
      return {
        cx: center + orbit * Math.cos(angle),
        cy: center + orbit * Math.sin(angle),
        r: tailRadius + (headRadius - tailRadius) * progress,
        opacity: 0.15 + 0.85 * progress,
      };
    });
  }, [size]);

  return (
    <Root>
      <Animated.View style={[{ width: size, height: size }, spinStyle]}>
        <Svg width={size} height={size}>
          {dots.map((dot, index) => (
            <Circle key={index} cx={dot.cx} cy={dot.cy} r={dot.r} fill={tint} opacity={dot.opacity} />
          ))}
        </Svg>
      </Animated.View>
      {label ? <Label>{label}</Label> : null}
    </Root>
  );
}

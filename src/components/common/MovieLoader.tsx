import { Feather } from "@expo/vector-icons";
import { useEffect } from "react";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

type MovieLoaderProps = {
  size?: number;
  label?: string;
};

const Root = styled.View`
  align-items: center;
  justify-content: center;
`;

const ReelWrap = styled.View<{ $size: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  align-items: center;
  justify-content: center;
`;

const ReelRing = styled(Animated.View)<{ $size: number; $primary: string; $primaryMuted: string }>`
  position: absolute;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  border-width: 2px;
  border-color: rgba(255, 255, 255, 0.2);
  border-top-color: ${({ $primary }) => $primary};
  border-right-color: ${({ $primaryMuted }) => $primaryMuted};
`;

const IconShell = styled(Animated.View)<{ $size: number }>`
  width: ${({ $size }) => Math.round($size * 0.54)}px;
  height: ${({ $size }) => Math.round($size * 0.54)}px;
  border-radius: ${({ $size }) => Math.round(($size * 0.54) / 2)}px;
  background-color: rgba(255, 255, 255, 0.07);
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

export function MovieLoader({ size = 44, label }: MovieLoaderProps) {
  const currentTheme = useTheme();
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, {
        duration: 1150,
        easing: Easing.linear
      }),
      -1,
      false
    );

    pulse.value = withRepeat(
      withTiming(1, {
        duration: 900,
        easing: Easing.inOut(Easing.quad)
      }),
      -1,
      true
    );
  }, [pulse, spin]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }]
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.95, 1.05]) }],
    opacity: interpolate(pulse.value, [0, 1], [0.78, 1])
  }));

  return (
    <Root>
      <ReelWrap $size={size}>
        <ReelRing
          $size={size}
          $primary={currentTheme.colors.primary}
          $primaryMuted={currentTheme.colors.primaryMuted}
          style={ringStyle}
        />
        <IconShell $size={size} style={iconStyle}>
          <Feather name="film" size={Math.round(size * 0.34)} color="#FFFFFF" />
        </IconShell>
      </ReelWrap>
      {label ? <Label>{label}</Label> : null}
    </Root>
  );
}

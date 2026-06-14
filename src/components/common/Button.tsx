import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle
} from "react-native";
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { useTheme } from "styled-components/native";

import { useReduceMotion } from "../../hooks/useReduceMotion";
import { AppText } from "./AppText";

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Renders before the label (e.g. an icon). */
  leading?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Accessibility label override. Defaults to `label`. Set when the visible
   * label isn't descriptive enough for screen readers.
   */
  accessibilityLabel?: string;
};

const SIZE_MAP: Record<ButtonSize, { minHeight: number; paddingHorizontal: number }> = {
  // minHeight >= 44 to meet the platform touch-target guideline.
  sm: { minHeight: 44, paddingHorizontal: 16 },
  md: { minHeight: 50, paddingHorizontal: 20 },
  lg: { minHeight: 56, paddingHorizontal: 24 }
};

/**
 * Button — the single pressable-action primitive.
 *
 * Replaces the ~50 ad-hoc styled buttons across screens. Carries, in one place:
 *  - accessibility (`role=button`, label, disabled/busy state)
 *  - a 44pt+ touch target
 *  - tokenized variant colors (no hardcoded hex)
 *  - press-scale feedback that respects the OS "reduce motion" setting
 *  - a loading spinner state
 */
export function Button({
  label,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  leading,
  fullWidth = false,
  style,
  accessibilityLabel,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);

  const sizing = SIZE_MAP[size];
  const isInteractive = !disabled && !loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      if (!reduceMotion) {
        scale.value = withTiming(theme.motion.pressScale, { duration: theme.motion.durationFast });
      }
      onPressIn?.(event);
    },
    [onPressIn, scale, theme.motion.pressScale, theme.motion.durationFast, reduceMotion]
  );

  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      if (!reduceMotion) {
        scale.value = withTiming(1, { duration: theme.motion.durationFast });
      }
      onPressOut?.(event);
    },
    [onPressOut, scale, theme.motion.durationFast, reduceMotion]
  );

  const backgroundColor =
    variant === "primary"
      ? theme.colors.primary
      : variant === "secondary"
        ? theme.colors.surface
        : "transparent";
  const borderColor = variant === "secondary" ? theme.colors.border : "transparent";
  const textColor = variant === "primary" ? "onPrimary" : "primary";

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
      disabled={!isInteractive}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        {
          minHeight: sizing.minHeight,
          paddingHorizontal: sizing.paddingHorizontal,
          borderRadius: theme.radius.pill,
          backgroundColor,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          opacity: isInteractive ? 1 : 0.4,
          alignSelf: fullWidth ? "stretch" : "auto"
        },
        animatedStyle,
        style
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? theme.colors.textOnPrimary : theme.colors.primary} />
      ) : (
        <>
          {leading ? <View style={{ marginRight: 8 }}>{leading}</View> : null}
          <AppText variant="Button" color={textColor}>
            {label}
          </AppText>
        </>
      )}
    </AnimatedPressable>
  );
}

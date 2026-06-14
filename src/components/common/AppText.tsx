import { forwardRef } from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { useTheme } from "styled-components/native";

import type { Typography } from "../../theme/Typography";

export type TypographyVariant = keyof typeof Typography;

/** Semantic text colors mapped to theme tokens. */
export type AppTextColor =
  | "primary"
  | "secondary"
  | "tertiary"
  | "onPrimary"
  | "accent";

type AppTextProps = RNTextProps & {
  /** Typography token (font family + size + line height + letter spacing). */
  variant?: TypographyVariant;
  /** Semantic color token. Defaults to primary text. */
  color?: AppTextColor;
  /**
   * Cap on dynamic-type scaling so large system fonts can't shatter layouts.
   * Defaults to 1.3 — generous for readability, safe for fixed-height UI.
   * Pass `undefined` explicitly to opt out of the cap.
   */
  maxFontSizeMultiplier?: number | null;
};

function resolveColor(theme: ReturnType<typeof useTheme>, color: AppTextColor): string {
  switch (color) {
    case "secondary":
      return theme.colors.textSecondary;
    case "tertiary":
      return theme.colors.textTertiary;
    case "onPrimary":
      return theme.colors.textOnPrimary;
    case "accent":
      return theme.colors.primary;
    case "primary":
    default:
      return theme.colors.textPrimary;
  }
}

/**
 * AppText — the single text primitive.
 *
 * Centralizes typography tokens, semantic color, and a dynamic-type cap so every
 * label is consistent and accessible without each screen re-specifying fonts.
 * Falls back to sensible defaults; `style` still overrides for one-offs.
 */
export const AppText = forwardRef<RNText, AppTextProps>(function AppText(
  { variant = "BodyMedium", color = "primary", maxFontSizeMultiplier = 1.3, style, ...rest },
  ref
) {
  const theme = useTheme();
  const typography = theme.typography[variant];

  return (
    <RNText
      ref={ref}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? undefined}
      style={[
        {
          fontFamily: typography.fontFamily,
          fontSize: typography.fontSize,
          lineHeight: typography.lineHeight,
          letterSpacing: typography.letterSpacing,
          color: resolveColor(theme, color)
        },
        style
      ]}
      {...rest}
    />
  );
});

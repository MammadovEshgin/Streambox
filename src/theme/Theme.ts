import { Typography } from "./Typography";

export type ThemeId =
  | "emerald-noir"
  | "cinema-ember"
  | "velvet-crimson"
  | "aurora-cyan";

type ThemeOption = {
  id: ThemeId;
  name: string;
  description: string;
  primary: string;
  primaryDesaturated: string;
};

export const DEFAULT_THEME_ID: ThemeId = "emerald-noir";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "emerald-noir",
    name: "Emerald Noir",
    description: "Dark screen, rich green highlights, understated and premium.",
    primary: "#22C55E",
    primaryDesaturated: "#3DAA70"
  },
  {
    id: "cinema-ember",
    name: "Cinema Ember",
    description: "Classic StreamBox heat with a premium cinema glow.",
    primary: "#FF4D00",
    primaryDesaturated: "#E8632A"
  },
  {
    id: "velvet-crimson",
    name: "Netflix Red",
    description: "Netflix-inspired signature red for a bold but familiar premium streaming look.",
    primary: "#E50914",
    primaryDesaturated: "#D43743"
  },
  {
    id: "aurora-cyan",
    name: "Prime Video Blue",
    description: "Prime Video-inspired blue with a bright streaming accent and familiar dark-mode contrast.",
    primary: "#00A8E1",
    primaryDesaturated: "#3AAAD0"
  }
];

const THEME_IDS = new Set<ThemeId>(THEME_OPTIONS.map((option) => option.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value as ThemeId);
}

export function resolveThemeId(value: unknown, fallback: ThemeId = DEFAULT_THEME_ID): ThemeId {
  return isThemeId(value) ? value : fallback;
}

export function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace("#", "");
  const normalized = sanitized.length === 3
    ? sanitized
        .split("")
        .map((char) => `${char}${char}`)
        .join("")
    : sanitized;

  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveThemeOption(themeId: ThemeId): ThemeOption {
  return THEME_OPTIONS.find((option) => option.id === themeId) ?? THEME_OPTIONS[0];
}

export function createTheme(themeId: ThemeId = DEFAULT_THEME_ID) {
  const option = resolveThemeOption(themeId);
  const accent = option.primaryDesaturated;

  return {
    id: option.id,
    displayName: option.name,
    colors: {
      background: "#0B0B0E",
      surface: "#131318",
      surfaceRaised: "#1B1B22",
      surfaceHigh: "#23232C",
      primary: accent,
      primarySoft: withAlpha(accent, 0.14),
      primarySoftStrong: withAlpha(accent, 0.22),
      primaryMuted: withAlpha(accent, 0.4),
      primaryGlow: withAlpha(accent, 0.32),
      primaryTransparent: withAlpha(accent, 0),
      textPrimary: "#F2F1EE",
      textSecondary: "#9A9AA8",
      textTertiary: "#5C5C68",
      border: "#2A2A33",
      borderSoft: "#1F1F26",
      overlayScrim: "rgba(11, 11, 14, 0.72)",
      glassFill: "rgba(255, 255, 255, 0.06)",
      glassBorder: "rgba(255, 255, 255, 0.10)"
    },
    typography: Typography,
    spacing: {
      xxs: 2,
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      xxl: 40,
      huge: 64
    },
    radius: {
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      pill: 999,
      full: 9999
    },
    motion: {
      pressScale: 0.97,
      durationFast: 120,
      durationBase: 200,
      durationSlow: 280,
      durationCommitted: 600
    }
  };
}

export const theme = createTheme(DEFAULT_THEME_ID);

export type AppTheme = ReturnType<typeof createTheme>;

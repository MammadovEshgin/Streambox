import { Typography } from "./Typography";

export type ThemeId =
  | "cinema-ember"
  | "velvet-crimson"
  | "aurora-cyan"
  | "emerald-noir"
  | "luxe-gold"
  | "glacier-blue";

type ThemeOption = {
  id: ThemeId;
  name: string;
  description: string;
  primary: string;
};

export const DEFAULT_THEME_ID: ThemeId = "cinema-ember";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "cinema-ember",
    name: "Cinema Ember",
    description: "Classic StreamBox heat with a premium cinema glow.",
    primary: "#FF4D00"
  },
  {
    id: "velvet-crimson",
    name: "Netflix Red",
    description: "Netflix-inspired signature red for a bold but familiar premium streaming look.",
    primary: "#E50914"
  },
  {
    id: "aurora-cyan",
    name: "Prime Video Blue",
    description: "Prime Video-inspired blue with a bright streaming accent and familiar dark-mode contrast.",
    primary: "#00A8E1"
  },
  {
    id: "emerald-noir",
    name: "Emerald Noir",
    description: "Dark screen, rich green highlights, understated and premium.",
    primary: "#22C55E"
  },
  {
    id: "luxe-gold",
    name: "Luxe Gold",
    description: "Soft brushed gold with warm editorial character and less visual fatigue.",
    primary: "#B9974F"
  },
  {
    id: "glacier-blue",
    name: "Glacier Blue",
    description: "Refined slate-blue accent with a cool premium tone instead of harsh brightness.",
    primary: "#7B97C9"
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

  return {
    id: option.id,
    displayName: option.name,
    colors: {
      background: "#080808",
      surface: "#101012",
      surfaceRaised: "#18181B",
      surfaceHigh: "#18181B",
      primary: option.primary,
      primarySoft: withAlpha(option.primary, 0.14),
      primarySoftStrong: withAlpha(option.primary, 0.2),
      primaryMuted: withAlpha(option.primary, 0.4),
      primaryGlow: withAlpha(option.primary, 0.35),
      primaryTransparent: withAlpha(option.primary, 0),
      textPrimary: "#F4F4F5",
      textSecondary: "#A1A1AA",
      textTertiary: "#A1A1AA",
      border: "#27272A",
      borderSoft: "#27272A",
      overlayScrim: "rgba(8, 8, 8, 0.72)",
      glassFill: "rgba(255, 255, 255, 0.05)",
      glassBorder: "rgba(255, 255, 255, 0.08)"
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

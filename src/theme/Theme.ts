import { Typography } from "./Typography";

export type ThemeId =
  | "cinema-ember"
  | "velvet-crimson"
  | "emerald-noir"
  | "glacier-blue";

type ThemeOption = {
  id: ThemeId;
  name: string;
  description: string;
  primary: string;
};

export const DEFAULT_THEME_ID: ThemeId = "emerald-noir";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "emerald-noir",
    name: "Emerald Noir",
    description: "Dark screen, rich green highlights, understated and premium.",
    primary: "#22C55E"
  },
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
      background: "#0D100F",
      surface: "#151917",
      surfaceRaised: "#1B211E",
      surfaceHigh: "#232A26",
      primary: option.primary,
      primarySoft: withAlpha(option.primary, 0.12),
      primarySoftStrong: withAlpha(option.primary, 0.18),
      primaryMuted: withAlpha(option.primary, 0.36),
      primaryGlow: withAlpha(option.primary, 0.28),
      primaryTransparent: withAlpha(option.primary, 0),
      textPrimary: "#F6F7F4",
      textSecondary: "#B2B8B1",
      textTertiary: "#858D86",
      /** Text/icon color rendered on top of a `primary`-filled surface. */
      textOnPrimary: "#FFFFFF",
      border: "#2A312D",
      borderSoft: "#202722",
      overlayScrim: "rgba(13, 16, 15, 0.70)",
      /** Full-bleed dim behind modals/sheets. */
      scrim: "rgba(0, 0, 0, 0.72)",
      /** Rating / star accent — was hardcoded as #FFD700 / #FFD27A in places. */
      gold: "#FFD700",
      glassFill: "rgba(255, 255, 255, 0.065)",
      glassBorder: "rgba(255, 255, 255, 0.11)"
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
    },
    shadows: {
      // Elevation presets so shadows aren't hand-rolled per component.
      // Spread into a styled View / RN style object.
      card: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6
      },
      raised: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 12
      }
    }
  };
}

export const theme = createTheme(DEFAULT_THEME_ID);

export type AppTheme = ReturnType<typeof createTheme>;

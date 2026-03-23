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
      background: "#080808", // Off-black base
      surface: "#101012",    // Subtle tint lifted surface
      surfaceRaised: "#18181B", // Slightly higher elevation
      primary: option.primary,
      primarySoft: withAlpha(option.primary, 0.14),
      primarySoftStrong: withAlpha(option.primary, 0.2),
      primaryMuted: withAlpha(option.primary, 0.4),
      primaryGlow: withAlpha(option.primary, 0.35),
      primaryTransparent: withAlpha(option.primary, 0),
      textPrimary: "#F4F4F5", // Softer white to reduce eye strain
      textSecondary: "#A1A1AA", // Muted gray for subtle contrast
      border: "#27272A" // Low-contrast border
    },
    typography: Typography,
    spacing: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24
    },
    radius: {
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24, // Rounder for cards layout
      full: 9999
    }
  };
}

export const theme = createTheme(DEFAULT_THEME_ID);

export type AppTheme = ReturnType<typeof createTheme>;
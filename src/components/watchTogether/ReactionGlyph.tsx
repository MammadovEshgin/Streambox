import Svg, { Path, Polygon } from "react-native-svg";
import { useTheme } from "styled-components/native";

// A restrained, grown-up reaction set: flat single-weight glyphs in the app's
// accent (green in Emerald Noir), no cartoon faces. Heart (love), star
// (masterpiece), flame (intense), bolt (electric), sparkle (wow). Used both in
// the picker and as the reactions that float up over the video.

export const REACTIONS = ["heart", "star", "flame", "bolt", "sparkle"] as const;
export type ReactionId = (typeof REACTIONS)[number];

export function isReactionId(value: string): value is ReactionId {
  return (REACTIONS as readonly string[]).includes(value);
}

export function ReactionGlyph({ id, size = 26 }: { id: ReactionId; size?: number }) {
  const theme = useTheme();
  const c = theme.colors.primary;
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      {id === "heart" ? (
        <Path
          d="M18 29.3 C 7.4 21.3 5 15.4 9 11.3 C 12 8.2 15.7 9.3 18 12.3 C 20.3 9.3 24 8.2 27 11.3 C 31 15.4 28.6 21.3 18 29.3 Z"
          fill={c}
        />
      ) : null}
      {id === "star" ? (
        <Polygon
          points="18,4.5 21.3,13.4 30.7,13.8 23.2,19.6 25.9,28.7 18,23.3 10.1,28.7 12.8,19.6 5.3,13.8 14.7,13.4"
          fill={c}
          stroke={c}
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
      ) : null}
      {id === "flame" ? (
        <Path
          d="M18 4 C 24 12 26 16 26 20.5 C 26 25.7 22.6 30 18 30 C 13.4 30 10 25.7 10 20.5 C 10 16.5 12.4 14.5 14 12 C 14.4 15 16.4 15.4 16.6 12.6 C 16.9 9 17.2 6.6 18 4 Z"
          fill={c}
        />
      ) : null}
      {id === "bolt" ? (
        <Polygon
          points="21,3.5 9,21 16.4,21 15,32.5 27,14 19.6,14"
          fill={c}
          stroke={c}
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
      ) : null}
      {id === "sparkle" ? (
        <Path
          d="M18 3 C 19 13 23 17 33 18 C 23 19 19 23 18 33 C 17 23 13 19 3 18 C 13 17 17 13 18 3 Z"
          fill={c}
        />
      ) : null}
    </Svg>
  );
}

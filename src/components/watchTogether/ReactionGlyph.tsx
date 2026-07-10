import Svg, { Circle, Defs, Ellipse, Path, Polygon, RadialGradient, Stop } from "react-native-svg";

// Five hand-built reaction glyphs tuned to the emotions of watching a film
// together: a belly laugh (comedy), heart-eyes (romance), star-struck (the
// jaw-drop epic), tears (the drama cry), and a scream (horror/thriller). Drawn
// in SVG so they carry a warmer, on-brand look than system emoji and can float
// up over the video when sent.

export const REACTIONS = ["laugh", "love", "wow", "cry", "scream"] as const;
export type ReactionId = (typeof REACTIONS)[number];

export function isReactionId(value: string): value is ReactionId {
  return (REACTIONS as readonly string[]).includes(value);
}

const FACE = "#FFC93D";
const FACE_HI = "#FFE178";
const FACE_EDGE = "#E7A81C";
const INK = "#5A2A1E";
const TEAR = "#5BC1F2";
const HEART = "#FF4D6D";
const TONGUE = "#F1738B";
const STAR = "#F4A417";

const STAR_PTS = "5,0.4 6.1,3.8 9.7,3.8 6.8,6.0 7.9,9.6 5,7.4 2.1,9.6 3.2,6.0 0.3,3.8 3.9,3.8";

function star(cx: number, cy: number, s: number, fill: string, key?: string) {
  return (
    <Polygon
      key={key}
      points={STAR_PTS}
      transform={`translate(${cx - 5 * s}, ${cy - 5 * s}) scale(${s})`}
      fill={fill}
    />
  );
}

function heart(cx: number, cy: number) {
  return (
    <Path
      d={`M ${cx} ${cy + 3} C ${cx - 4.2} ${cy - 1.4} ${cx - 4.2} ${cy - 5.4} ${cx} ${cy - 2} C ${cx + 4.2} ${cy - 5.4} ${cx + 4.2} ${cy - 1.4} ${cx} ${cy + 3} Z`}
      fill={HEART}
    />
  );
}

export function ReactionGlyph({ id, size = 26 }: { id: ReactionId; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Defs>
        <RadialGradient id={`face-${id}`} cx="42%" cy="34%" r="78%">
          <Stop offset="0" stopColor={FACE_HI} />
          <Stop offset="1" stopColor={FACE} />
        </RadialGradient>
      </Defs>
      <Circle cx={18} cy={18} r={16.5} fill={`url(#face-${id})`} stroke={FACE_EDGE} strokeWidth={1} />
      {id === "laugh" ? (
        <>
          <Path d="M8.5 16 Q12 11.5 15.5 16" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M20.5 16 Q24 11.5 27.5 16" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M9 21 Q18 24 27 21 Q25 32 18 32 Q11 32 9 21 Z" fill={INK} />
          <Path d="M11 22 Q18 24.2 25 22 L25 23.1 Q18 25.2 11 23.1 Z" fill="#FFFFFF" />
          <Ellipse cx={18} cy={29.5} rx={4.4} ry={2.4} fill={TONGUE} />
          <Path d="M5.6 14.5 Q4.2 18.4 5.6 20 Q7.2 18.4 5.6 14.5 Z" fill={TEAR} />
          <Path d="M30.4 14.5 Q29 18.4 30.4 20 Q31.8 18.4 30.4 14.5 Z" fill={TEAR} />
        </>
      ) : null}
      {id === "love" ? (
        <>
          {heart(12, 15)}
          {heart(24, 15)}
          <Path d="M10 22 Q18 32 26 22 Q18 26 10 22 Z" fill={INK} />
          <Ellipse cx={18} cy={28.4} rx={4} ry={2.2} fill={TONGUE} />
        </>
      ) : null}
      {id === "wow" ? (
        <>
          {star(12, 15, 1.25, STAR)}
          {star(24, 15, 1.25, STAR)}
          <Path d="M11.5 23 Q18 27 24.5 23 Q22 31 18 31 Q14 31 11.5 23 Z" fill={INK} />
          {star(5.5, 8.5, 0.42, "#FFFFFF")}
          {star(30.5, 10, 0.42, "#FFFFFF")}
        </>
      ) : null}
      {id === "cry" ? (
        <>
          <Path d="M8.5 13.5 Q12 16.8 15.5 13.5" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M20.5 13.5 Q24 16.8 27.5 13.5" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M12 15.5 Q9.4 22 12 27 Q14.6 22 12 15.5 Z" fill={TEAR} />
          <Path d="M24 15.5 Q21.4 22 24 27 Q26.6 22 24 15.5 Z" fill={TEAR} />
          <Ellipse cx={18} cy={27} rx={4.4} ry={3.2} fill={INK} />
        </>
      ) : null}
      {id === "scream" ? (
        <>
          <Path d="M8 9.8 Q12 8 16 9.8" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <Path d="M20 9.8 Q24 8 28 9.8" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <Ellipse cx={12} cy={15.5} rx={3} ry={4} fill="#FFFFFF" stroke={INK} strokeWidth={0.8} />
          <Ellipse cx={24} cy={15.5} rx={3} ry={4} fill="#FFFFFF" stroke={INK} strokeWidth={0.8} />
          <Circle cx={12} cy={16.5} r={1.7} fill={INK} />
          <Circle cx={24} cy={16.5} r={1.7} fill={INK} />
          <Ellipse cx={18} cy={26} rx={3.8} ry={5} fill={INK} />
        </>
      ) : null}
    </Svg>
  );
}

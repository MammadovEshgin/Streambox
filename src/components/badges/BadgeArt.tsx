// Hand-built flat vector badge art (no image assets). Shared design tokens:
// 100x100 viewBox, white disc with a colored ring, uniform ink linework,
// 2-3 flat accent colors per badge, and an expressive face for personality.
// The movie-count ladder reuses one film-reel mascot whose accessories and
// ring color evolve with the tier.

import type { ReactElement } from "react";
import Svg, { Circle, Ellipse, Line, Path, Rect } from "react-native-svg";

import { BADGE_DEFINITION_MAP, type BadgeId } from "../../constants/badges";

const INK = "#232833";
const REEL_BODY = "#FFCE54";
const REEL_HOLE = "#FFF7E0";

type ArtProps = { ring: string };

function Disc({ ring }: ArtProps) {
  return (
    <>
      <Circle cx={50} cy={50} r={45} fill="#FFFFFF" />
      <Circle cx={50} cy={50} r={45} fill="none" stroke={ring} strokeWidth={5} />
    </>
  );
}

function DotEyes({ y = 51, dx = 6.5, r = 2.7 }: { y?: number; dx?: number; r?: number }) {
  return (
    <>
      <Circle cx={50 - dx} cy={y} r={r} fill={INK} />
      <Circle cx={50 + dx} cy={y} r={r} fill={INK} />
    </>
  );
}

function HappyEyes({ y = 51, dx = 6.5 }: { y?: number; dx?: number }) {
  return (
    <>
      <Path d={`M${47 - dx},${y} q${3},-3.6 ${6},0`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Path d={`M${47 + dx},${y} q${3},-3.6 ${6},0`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
    </>
  );
}

function Smile({ y = 59, w = 9 }: { y?: number; w?: number }) {
  return (
    <Path d={`M${50 - w / 2},${y} q${w / 2},${w * 0.55} ${w},0`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
  );
}

function OpenSmile({ y = 57, w = 13 }: { y?: number; w?: number }) {
  return <Path d={`M${50 - w / 2},${y} a${w / 2},${w / 2} 0 0 0 ${w},0 z`} fill={INK} />;
}

function Sparkle({ x, y, s = 3.4, color = INK }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <Path
      d={`M${x},${y - s} L${x + s * 0.32},${y - s * 0.32} L${x + s},${y} L${x + s * 0.32},${y + s * 0.32} L${x},${y + s} L${x - s * 0.32},${y + s * 0.32} L${x - s},${y} L${x - s * 0.32},${y - s * 0.32} Z`}
      fill={color}
    />
  );
}

/** Shared film-reel mascot body for the milestone ladder. */
function ReelBody() {
  return (
    <>
      <Circle cx={50} cy={53} r={19} fill={REEL_BODY} stroke={INK} strokeWidth={3} />
      <Circle cx={40.5} cy={42.5} r={3} fill={REEL_HOLE} stroke={INK} strokeWidth={2} />
      <Circle cx={50} cy={39} r={3} fill={REEL_HOLE} stroke={INK} strokeWidth={2} />
      <Circle cx={59.5} cy={42.5} r={3} fill={REEL_HOLE} stroke={INK} strokeWidth={2} />
    </>
  );
}

function FirstReelArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <ReelBody />
      <DotEyes y={52.5} dx={6} r={3.1} />
      <Circle cx={50} cy={60.5} r={2.3} fill={INK} />
      <Sparkle x={73} y={31} color={ring} />
    </>
  );
}

function RookieArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <Line x1={20} y1={46} x2={28} y2={46} stroke={ring} strokeWidth={2.6} strokeLinecap="round" />
      <Line x1={17} y1={53} x2={27} y2={53} stroke={ring} strokeWidth={2.6} strokeLinecap="round" />
      <Line x1={20} y1={60} x2={28} y2={60} stroke={ring} strokeWidth={2.6} strokeLinecap="round" />
      <ReelBody />
      <DotEyes y={52} />
      {/* determined grin */}
      <Path d="M44,59.5 q6,4.5 12,0" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Path d="M44,59.5 l-1.5,-2" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
    </>
  );
}

function RegularArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <ReelBody />
      {/* chill half-closed eyes */}
      <Line x1={41} y1={52} x2={47} y2={52} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      <Line x1={53} y1={52} x2={59} y2={52} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      <Smile y={58.5} />
      {/* floating popcorn */}
      <Circle cx={73} cy={58} r={3.4} fill="#FFF3D6" stroke={INK} strokeWidth={2} />
      <Circle cx={78} cy={49} r={2.7} fill="#FFF3D6" stroke={INK} strokeWidth={2} />
      <Circle cx={70} cy={47} r={2.4} fill="#FFF3D6" stroke={INK} strokeWidth={2} />
    </>
  );
}

function MovieBuffArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <ReelBody />
      <Circle cx={43.5} cy={52} r={5.6} fill="#FFFFFF" stroke={INK} strokeWidth={2.4} />
      <Circle cx={56.5} cy={52} r={5.6} fill="#FFFFFF" stroke={INK} strokeWidth={2.4} />
      <Line x1={49} y1={52} x2={51} y2={52} stroke={INK} strokeWidth={2.4} />
      <Circle cx={43.5} cy={52} r={1.9} fill={INK} />
      <Circle cx={56.5} cy={52} r={1.9} fill={INK} />
      <Smile y={61} />
    </>
  );
}

function CinephileArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <ReelBody />
      {/* beret resting on the reel */}
      <Ellipse cx={45} cy={34} rx={12.5} ry={5.2} fill={INK} transform="rotate(-8 45 34)" />
      <Circle cx={45} cy={28.5} r={1.8} fill={INK} />
      <HappyEyes y={52} />
      <Smile y={58.5} w={7} />
      {/* tiny espresso cup */}
      <Rect x={66} y={56} width={8} height={6.5} rx={1.5} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
      <Path d="M74,57.5 q4,1.5 0,3.5" stroke={INK} strokeWidth={2} fill="none" />
      <Path d="M68.5,53.5 q1,-2 0,-3.5 M71.5,53.5 q1,-2 0,-3.5" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    </>
  );
}

function FilmFanaticArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <ReelBody />
      {/* spiral hypnotized eyes */}
      <Circle cx={43.5} cy={52} r={4.4} fill="none" stroke={INK} strokeWidth={2} />
      <Circle cx={43.5} cy={52} r={1.5} fill={INK} />
      <Circle cx={56.5} cy={52} r={4.4} fill="none" stroke={INK} strokeWidth={2} />
      <Circle cx={56.5} cy={52} r={1.5} fill={INK} />
      <OpenSmile y={60} w={12} />
      {/* sweat drop */}
      <Path d="M71,38 q3.5,5 0,7.5 q-3.5,-2.5 0,-7.5 z" fill="#6EC6FF" stroke={INK} strokeWidth={1.6} />
    </>
  );
}

function ScreenLegendArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <ReelBody />
      {/* crown */}
      <Path d="M38,33 L41,24 L46.5,30 L50,22.5 L53.5,30 L59,24 L62,33 Z" fill="#F5B120" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <DotEyes y={52} />
      {/* smug one-sided smile */}
      <Path d="M44,59 q6,4 12,0 q1.5,-1.2 1.8,-2.6" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Sparkle x={26} y={36} color="#F5B120" />
      <Sparkle x={75} y={62} s={2.8} color="#F5B120" />
    </>
  );
}

function FearCollectorArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* ghost with a wavy hem, mid jump-scare */}
      <Path
        d="M34,47 a16,16 0 0 1 32,0 v16 q-2.7,-3.4 -5.4,0 q-2.6,3.4 -5.3,0 q-2.6,-3.4 -5.3,0 q-2.7,3.4 -5.4,0 q-2.6,-3.4 -5.3,0 q-2.7,3.4 -5.3,0 z"
        fill="#F1EDFF"
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Ellipse cx={44} cy={46} rx={2.3} ry={3.4} fill={INK} />
      <Ellipse cx={56} cy={46} rx={2.3} ry={3.4} fill={INK} />
      <Ellipse cx={50} cy={55} rx={3.4} ry={4.2} fill={INK} />
      {/* one tiny fang */}
      <Path d="M48,52.5 l1.6,3 l1.6,-3 z" fill="#FFFFFF" />
      <Circle cx={27} cy={40} r={1.7} fill={ring} />
      <Circle cx={74} cy={57} r={1.7} fill={ring} />
    </>
  );
}

function LaughTrackArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <Ellipse cx={50} cy={52} rx={16} ry={17.5} fill="#FFE066" stroke={INK} strokeWidth={3} />
      {/* eyes squeezed shut laughing */}
      <Path d="M40.5,48.5 l3.4,-3 l3.4,3" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M52.7,48.5 l3.4,-3 l3.4,3" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M42,56 a8,8 0 0 0 16,0 z" fill={INK} />
      <Path d="M45,56.4 h10 v2 a5,3 0 0 1 -10,0 z" fill="#FFFFFF" />
      {/* tears flying off */}
      <Path d="M27,44 q-3.5,4 0,6.5 q3,-2.5 0,-6.5 z" fill="#4FC3F7" stroke={INK} strokeWidth={1.5} />
      <Path d="M73,44 q3.5,4 0,6.5 q-3,-2.5 0,-6.5 z" fill="#4FC3F7" stroke={INK} strokeWidth={1.5} />
    </>
  );
}

function HeartlinesArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <Path
        d="M50,68 C38.5,58.5 33,51.5 33,44.5 a8.6,8.6 0 0 1 17,-1.4 a8.6,8.6 0 0 1 17,1.4 c0,7 -5.5,14 -17,23.5 z"
        fill="#FF6B9D"
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <HappyEyes y={48} dx={6} />
      <Smile y={54.5} w={7} />
      {/* rosy cheeks */}
      <Circle cx={40.5} cy={51} r={2} fill="#FFB3C9" />
      <Circle cx={59.5} cy={51} r={2} fill="#FFB3C9" />
      <Path d="M72,34 c-1.8,-2.6 -5.4,-0.6 -4.2,2 c0.8,1.8 4.2,3.4 4.2,3.4 c0,0 3.4,-1.6 4.2,-3.4 c1.2,-2.6 -2.4,-4.6 -4.2,-2 z" fill="#FFB3C9" />
    </>
  );
}

function CaseClosedArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* fingerprint being examined */}
      <Path d="M30,64 a5,5 0 0 1 10,0 M32.5,64 a2.5,2.5 0 0 1 5,0" stroke={ring} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      {/* lens with one giant suspicious eye */}
      <Circle cx={46} cy={45} r={15} fill="#E9FBF8" stroke={INK} strokeWidth={3.4} />
      <Line x1={37.5} y1={42} x2={54.5} y2={42} stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={46} cy={47} r={3.2} fill={INK} />
      {/* handle */}
      <Line x1={57} y1={56} x2={68} y2={67} stroke={INK} strokeWidth={7} strokeLinecap="round" />
      <Line x1={57.5} y1={56.5} x2={67} y2={66} stroke={ring} strokeWidth={3} strokeLinecap="round" />
    </>
  );
}

function StarboundArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* rocket body with the face on the hull */}
      <Path
        d="M50,22 q11,11 11,27 q0,8 -3.2,12.5 h-15.6 q-3.2,-4.5 -3.2,-12.5 q0,-16 11,-27 z"
        fill="#F6F8FC"
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Path d="M50,22 q6.5,6.5 9,14 h-18 q2.5,-7.5 9,-14 z" fill="#FF6B6B" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M39,52 l-7.5,8.5 l7.5,0.5 z" fill="#FF6B6B" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
      <Path d="M61,52 l7.5,8.5 l-7.5,0.5 z" fill="#FF6B6B" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
      <DotEyes y={45} dx={5.5} r={2.4} />
      <Path d="M45.5,50 a4.5,4.5 0 0 0 9,0 z" fill={INK} />
      {/* flame */}
      <Path d="M45,63 q5,9 10,0 q-2,9.5 -5,9.5 q-3,0 -5,-9.5 z" fill="#FFA726" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      <Sparkle x={26} y={38} s={2.8} color={ring} />
      <Sparkle x={75} y={30} s={2.4} color={ring} />
    </>
  );
}

function MarathonDayArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* popcorn pile */}
      <Circle cx={41} cy={44} r={4.6} fill="#FFF3D6" stroke={INK} strokeWidth={2.2} />
      <Circle cx={59} cy={44} r={4.6} fill="#FFF3D6" stroke={INK} strokeWidth={2.2} />
      <Circle cx={50} cy={40.5} r={5.4} fill="#FFF3D6" stroke={INK} strokeWidth={2.2} />
      <Circle cx={45} cy={45.5} r={4} fill="#FFF3D6" stroke={INK} strokeWidth={2.2} />
      <Circle cx={55} cy={45.5} r={4} fill="#FFF3D6" stroke={INK} strokeWidth={2.2} />
      {/* bucket with sleepy satisfied face */}
      <Path d="M36,49 L64,49 L61,73 L39,73 z" fill="#FFFFFF" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M40.2,49 L41.8,73 M59.8,49 L58.2,73" stroke={ring} strokeWidth={3.6} />
      {/* heavy eyelids */}
      <Path d="M45,58 q2,1.6 4,0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Path d="M51,58 q2,1.6 4,0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Smile y={64} w={7} />
      {/* dropped kernel */}
      <Circle cx={70} cy={65} r={2.6} fill="#FFF3D6" stroke={INK} strokeWidth={2} />
    </>
  );
}

function TimeTravelerArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* motion streaks */}
      <Line x1={19} y1={45} x2={28} y2={45} stroke={ring} strokeWidth={2.6} strokeLinecap="round" />
      <Line x1={16} y1={52} x2={26} y2={52} stroke={ring} strokeWidth={2.6} strokeLinecap="round" />
      <Line x1={19} y1={59} x2={28} y2={59} stroke={ring} strokeWidth={2.6} strokeLinecap="round" />
      {/* pocket watch sprinting */}
      <Rect x={47} y={29} width={8} height={5} rx={1.6} fill={INK} />
      <Circle cx={51} cy={52} r={16.5} fill="#FFF8E7" stroke={INK} strokeWidth={3.2} />
      <Line x1={51} y1={38} x2={51} y2={41.5} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1={51} y1={62.5} x2={51} y2={66} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1={37} y1={52} x2={40.5} y2={52} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1={61.5} y1={52} x2={65} y2={52} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <DotEyes y={49} dx={5.5} r={2.5} />
      {/* worried wobbly mouth */}
      <Path d="M46.5,57.5 q2.3,2.2 4.5,0 q2.3,-2.2 4.5,0" stroke={INK} strokeWidth={2.3} fill="none" strokeLinecap="round" />
    </>
  );
}

function OldSoulArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* twin reels */}
      <Circle cx={41.5} cy={35.5} r={7.8} fill="#D7B899" stroke={INK} strokeWidth={2.6} />
      <Circle cx={58.5} cy={35.5} r={7.8} fill="#D7B899" stroke={INK} strokeWidth={2.6} />
      <Circle cx={41.5} cy={35.5} r={2.2} fill={INK} />
      <Circle cx={58.5} cy={35.5} r={2.2} fill={INK} />
      {/* camera body with a distinguished face */}
      <Rect x={33} y={43} width={34} height={23} rx={4} fill="#B07A4B" stroke={INK} strokeWidth={3} />
      {/* monocle + plain eye */}
      <Circle cx={57} cy={51.5} r={4.4} fill="#FFFFFF" stroke={INK} strokeWidth={2.2} />
      <Circle cx={57} cy={51.5} r={1.7} fill={INK} />
      <Line x1={61} y1={54.5} x2={63.5} y2={60} stroke={INK} strokeWidth={1.6} />
      <Circle cx={44} cy={51.5} r={2.2} fill={INK} />
      {/* gray mustache */}
      <Path d="M43,59 q3.5,-3.4 7,0 q3.5,3.4 7,0" stroke="#E8E2D6" strokeWidth={3.4} fill="none" strokeLinecap="round" />
      {/* tripod */}
      <Line x1={43} y1={66} x2={38} y2={75} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      <Line x1={57} y1={66} x2={62} y2={75} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
    </>
  );
}

function DirectorsCircleArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* megaphone mid-shout */}
      <Path d="M30,45 L56,36 L56,64 L30,55 z" fill="#5C6BC0" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Ellipse cx={56} cy={50} rx={4.6} ry={14} fill="#7986CB" stroke={INK} strokeWidth={3} />
      <Path d="M34,55 l-1,7 l6,0 l0.4,-5" fill="none" stroke={INK} strokeWidth={2.8} strokeLinejoin="round" strokeLinecap="round" />
      {/* beret */}
      <Ellipse cx={37} cy={39.5} rx={9} ry={4} fill={INK} transform="rotate(-14 37 39.5)" />
      {/* googly eye + brow */}
      <Circle cx={40} cy={47.5} r={3.6} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
      <Circle cx={41} cy={48} r={1.5} fill={INK} />
      <Line x1={35.5} y1={43} x2={43} y2={44.4} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      {/* sound bursts */}
      <Path d="M66,40 q7,10 0,20" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Path d="M72,36 q10,14 0,28" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" opacity={0.45} />
    </>
  );
}

function HundredHoursArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      <Line x1={36} y1={30} x2={64} y2={30} stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <Line x1={36} y1={72} x2={64} y2={72} stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <Path
        d="M39.5,32 L60.5,32 Q60.5,44 52.5,50 Q60.5,56 60.5,70 L39.5,70 Q39.5,56 47.5,50 Q39.5,44 39.5,32 Z"
        fill="#F1EDFF"
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {/* film-grain sand */}
      <Circle cx={47.5} cy={64.5} r={2} fill={ring} />
      <Circle cx={52.5} cy={65.5} r={2} fill={ring} />
      <Circle cx={50} cy={60.5} r={1.7} fill={ring} />
      <Line x1={50} y1={50} x2={50} y2={56} stroke={ring} strokeWidth={1.8} strokeDasharray="2 2" />
      {/* zen face in the calm upper bulb */}
      <HappyEyes y={38.5} dx={4.6} />
      <Smile y={42} w={5} />
    </>
  );
}

function SeasonSlayerArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* antennae */}
      <Line x1={44} y1={40} x2={37} y2={28} stroke={INK} strokeWidth={2.8} strokeLinecap="round" />
      <Line x1={56} y1={40} x2={63} y2={28} stroke={INK} strokeWidth={2.8} strokeLinecap="round" />
      <Circle cx={37} cy={28} r={2} fill={INK} />
      <Circle cx={63} cy={28} r={2} fill={INK} />
      {/* retro tv, screen face binging with heart eyes */}
      <Rect x={31} y={40} width={38} height={28} rx={5} fill="#FFFFFF" stroke={INK} strokeWidth={3} />
      <Rect x={36} y={45} width={28} height={18} rx={3} fill="#D9F8FF" stroke={INK} strokeWidth={2.2} />
      <Path d="M44,51.5 c-1.5,-2.2 -4.6,-0.5 -3.6,1.7 c0.7,1.5 3.6,2.9 3.6,2.9 c0,0 2.9,-1.4 3.6,-2.9 c1,-2.2 -2.1,-3.9 -3.6,-1.7 z" fill="#FF6B9D" />
      <Path d="M56,51.5 c-1.5,-2.2 -4.6,-0.5 -3.6,1.7 c0.7,1.5 3.6,2.9 3.6,2.9 c0,0 2.9,-1.4 3.6,-2.9 c1,-2.2 -2.1,-3.9 -3.6,-1.7 z" fill="#FF6B9D" />
      <Path d="M46.5,58 a3.5,3.5 0 0 0 7,0 z" fill={INK} />
      {/* feet */}
      <Line x1={40} y1={68} x2={40} y2={72.5} stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <Line x1={60} y1={68} x2={60} y2={72.5} stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </>
  );
}

function OctoberRitesArt({ ring }: ArtProps) {
  return (
    <>
      <Disc ring={ring} />
      {/* stem + side lobes + face lobe */}
      <Path d="M48.5,42 q-0.5,-6 5,-8.5" stroke="#66BB6A" strokeWidth={4} fill="none" strokeLinecap="round" />
      <Ellipse cx={39.5} cy={56} rx={8.5} ry={11.5} fill="#FF9F40" stroke={INK} strokeWidth={2.8} />
      <Ellipse cx={60.5} cy={56} rx={8.5} ry={11.5} fill="#FF9F40" stroke={INK} strokeWidth={2.8} />
      <Ellipse cx={50} cy={56} rx={12} ry={12.5} fill="#FF9F40" stroke={INK} strokeWidth={2.8} />
      {/* carved triangle eye + wink */}
      <Path d="M41,51 l6,2.4 l-6,2.4 z" fill={INK} />
      <Path d="M54,53 q3,-3 6,0" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      {/* zigzag grin with a fang gap */}
      <Path d="M41.5,61 l3.6,2.8 l3.6,-2.8 l3.6,2.8 l3.6,-2.8 l3.6,2.8" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* bat buddy */}
      <Path d="M64,33 q3,-4 5,0 q2,-4 5,0 q-2,3.4 -5,2.4 q-3,1 -5,-2.4 z" fill={INK} />
    </>
  );
}

const BADGE_ART: Record<BadgeId, (props: ArtProps) => ReactElement> = {
  firstReel: FirstReelArt,
  rookie: RookieArt,
  regular: RegularArt,
  movieBuff: MovieBuffArt,
  cinephile: CinephileArt,
  filmFanatic: FilmFanaticArt,
  screenLegend: ScreenLegendArt,
  fearCollector: FearCollectorArt,
  laughTrack: LaughTrackArt,
  heartlines: HeartlinesArt,
  caseClosed: CaseClosedArt,
  starbound: StarboundArt,
  marathonDay: MarathonDayArt,
  timeTraveler: TimeTravelerArt,
  oldSoul: OldSoulArt,
  directorsCircle: DirectorsCircleArt,
  hundredHours: HundredHoursArt,
  seasonSlayer: SeasonSlayerArt,
  octoberRites: OctoberRitesArt,
};

type BadgeIconProps = {
  id: BadgeId;
  size: number;
};

export function BadgeIcon({ id, size }: BadgeIconProps) {
  const Art = BADGE_ART[id];
  const ring = BADGE_DEFINITION_MAP.get(id)?.ringColor ?? "#94A3B8";

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Art ring={ring} />
    </Svg>
  );
}

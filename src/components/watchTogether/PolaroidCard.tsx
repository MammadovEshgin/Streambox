import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { RefObject } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Defs, Line, Path, Pattern, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";
import ViewShot from "react-native-view-shot";
import styled from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";

// A "movie session" memory card rebuilt entirely in code/SVG (no template
// image). Aged near-white paper, a large framed still, two instant photos
// resting on its bottom edge, a hand-lettered hero flanked by popcorn + a
// MOVIE NIGHT ticket, and a typed MOVIE / DATE / RATING / GENRE log on ruled
// lines.

const CARD_W = 320;
const CARD_H = 430;

// Typewriter for the "typed" log + ticket, handwritten script for the hero.
const TYPEWRITER = "SpecialElite_400Regular";
const SCRIPT = "Caveat_700Bold";

// Aged paper, but leaning white/grey rather than yellow.
const PALETTE = {
  paperTop: "#F5F3ED",
  paperBottom: "#E7E4DB",
  ink: "#33302A",
  inkSoft: "#6E6A62",
  labelFaint: "rgba(51,48,42,0.40)",
  line: "#C8C4B8",
  frameEdge: "#B4AFA2",
  red: "#A6503E",
  redDeep: "#7C3A2C",
  slate: "#6E7C86",
  cream: "#FBFAF5",
  posterDark: "#12151B",
};

export type PolaroidCardProps = {
  viewShotRef?: RefObject<ViewShot | null>;
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  selfStillUri?: string | null;
  partnerStillUri?: string | null;
  selfNickname: string;
  partnerNickname?: string | null;
  dateEpochMs: number;
  rating?: number | null;
  genres?: string[] | null;
};

function formatDate(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatGenres(genres?: string[] | null): string {
  if (!genres || genres.length === 0) return "—";
  return genres.slice(0, 3).join("  ·  ");
}

const STAR_POINTS = "12,1 15,9 23,9 16,14 19,23 12,17 5,23 8,14 1,9 9,9";

// A 5-star rating rendered as SVG (out of 10 → 0..5 filled), so it always fits.
function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value / 2)));
  const size = 12;
  const gap = 2.5;
  const width = 5 * size + 4 * gap;
  return (
    <Svg width={width} height={size} viewBox={`0 0 ${width} ${size}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Polygon
          key={i}
          points={STAR_POINTS}
          transform={`translate(${i * (size + gap)}, 0) scale(${size / 24})`}
          fill={i < filled ? PALETTE.red : "none"}
          stroke={PALETTE.red}
          strokeWidth={i < filled ? 0 : 2}
        />
      ))}
    </Svg>
  );
}

// Classic red cinema ticket with a perforated stub.
function Ticket() {
  return (
    <View style={{ width: 64, height: 30 }}>
      <Svg width={64} height={30} viewBox="0 0 64 30" style={{ position: "absolute" }}>
        <Rect x={0.6} y={0.6} width={62.8} height={28.8} rx={4} fill={PALETTE.red} stroke={PALETTE.redDeep} strokeWidth={1} />
        <Line x1={45} y1={4} x2={45} y2={26} stroke="#e7cbc4" strokeWidth={1} strokeDasharray="2 2.5" />
        <Circle cx={45} cy={0.6} r={2.6} fill={PALETTE.paperTop} />
        <Circle cx={45} cy={29.4} r={2.6} fill={PALETTE.paperTop} />
      </Svg>
      <TicketMain>MOVIE{"\n"}NIGHT</TicketMain>
      <TicketStub>★</TicketStub>
    </View>
  );
}

// A proper cinema popcorn box: striped tapered tub, a rim, and a heap of
// buttery kernels spilling over the top.
function Popcorn() {
  const kernels: Array<[number, number, number, string]> = [
    [12, 8, 4.6, "#F6ECC0"],
    [19, 4, 4.3, "#ECD888"],
    [26, 6, 4.9, "#FBF4D6"],
    [33, 9, 4.4, "#ECD888"],
    [9, 13, 4.2, "#F6ECC0"],
    [16, 12, 4.8, "#FBF4D6"],
    [24, 12, 5.1, "#ECD888"],
    [31, 14, 4.5, "#F6ECC0"],
    [38, 12, 3.9, "#FBF4D6"],
    [21, 16, 4.3, "#F6ECC0"],
    [13, 17, 3.8, "#ECD888"],
    [29, 18, 3.7, "#FBF4D6"],
  ];
  return (
    <Svg width={40} height={46} viewBox="0 0 48 54">
      {/* tub (cream base) */}
      <Polygon points="7,23 41,23 36,52 12,52" fill={PALETTE.cream} stroke={PALETTE.redDeep} strokeWidth={1.1} />
      {/* red stripes tapering with the tub */}
      <Polygon points="7,23 13.8,23 16.8,52 12,52" fill={PALETTE.red} />
      <Polygon points="20.6,23 27.4,23 26.4,52 21.6,52" fill={PALETTE.red} />
      <Polygon points="34.2,23 41,23 36,52 31.2,52" fill={PALETTE.red} />
      {/* rim */}
      <Rect x={5} y={19.5} width={38} height={4.8} rx={1.8} fill="#F1EAD8" stroke={PALETTE.redDeep} strokeWidth={1.1} />
      {/* popcorn heap */}
      {kernels.map(([cx, cy, r, fill], i) => (
        <Circle key={i} cx={cx} cy={cy} r={r} fill={fill} stroke="#D8BE66" strokeWidth={0.5} />
      ))}
    </Svg>
  );
}

// Vintage Polaroid grade, approximating the Lightroom recipe with translucent
// overlays (RN has no colour curves/HSL, and overlays are what view-shot can
// actually capture). The dominant moves — Blacks +32, Whites -25, Contrast -22,
// Vibrance/Sat down, Temp +11, matte tone curve, soft warm vignette, Grain 35 —
// read as a warm milky matte, a warm cast with faintly cool shadows, a
// large-feather warm vignette, and medium grain.
const FILL = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };

function PhotoTreatment() {
  return (
    <>
      {/* Milky fade — lifts the blacks and drops contrast (the polaroid "haze"). */}
      <View style={[FILL, { backgroundColor: "rgba(214,206,188,0.17)" }]} pointerEvents="none" />
      {/* Warm highlights, faintly cool + desaturated shadows (Temp +11, split-tone). */}
      <LinearGradient
        colors={["rgba(255,201,133,0.13)", "rgba(190,180,150,0.05)", "rgba(96,120,124,0.09)"]}
        locations={[0, 0.5, 1]}
        style={FILL}
        pointerEvents="none"
      />
      <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
        <Defs>
          {/* Soft, large-feather warm vignette (Vignette -18, Feather 68). */}
          <RadialGradient id="vig" cx="50%" cy="46%" r="80%">
            <Stop offset="0.5" stopColor="#2e2416" stopOpacity={0} />
            <Stop offset="1" stopColor="#2e2416" stopOpacity={0.2} />
          </RadialGradient>
          {/* Medium film grain (Amount 35, larger + rougher). */}
          <Pattern id="grain" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <Rect width={4} height={4} fill="transparent" />
            <Circle cx={0.8} cy={0.7} r={0.5} fill="#000000" opacity={0.11} />
            <Circle cx={2.7} cy={1.6} r={0.45} fill="#ffffff" opacity={0.09} />
            <Circle cx={1.6} cy={3.0} r={0.45} fill="#000000" opacity={0.09} />
            <Circle cx={3.3} cy={3.4} r={0.4} fill="#ffffff" opacity={0.07} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#grain)" />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#vig)" />
      </Svg>
    </>
  );
}

export function PolaroidCard({
  viewShotRef,
  title,
  posterPath,
  backdropPath,
  selfStillUri,
  partnerStillUri,
  selfNickname,
  partnerNickname,
  dateEpochMs,
  rating,
  genres,
}: PolaroidCardProps) {
  // Prefer the landscape backdrop for the "screen" frame; fall back to poster.
  const stillSource = backdropPath ?? posterPath ?? null;
  const still = stillSource ? getTmdbImageUrl(stillSource, "original") : null;

  return (
    <ViewShot ref={viewShotRef} options={{ format: "png", quality: 1 }}>
      <Card>
        <LinearGradient
          colors={[PALETTE.paperTop, PALETTE.paperBottom]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <InnerFrame />

        {/* Large poster / backdrop still — no text over it */}
        <PosterFrame>
          <PosterInner>
            {still ? (
              <Image source={{ uri: still }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <View style={{ flex: 1, backgroundColor: PALETTE.posterDark }} />
            )}
          </PosterInner>
        </PosterFrame>

        {/* Tape on the still's top corners */}
        <Tape style={{ left: 32, top: 6, transform: [{ rotate: "-22deg" }] }} />
        <Tape style={{ right: 32, top: 6, transform: [{ rotate: "20deg" }] }} />

        {/* Viewer instant photos resting on the bottom edge of the still */}
        <Polaroid style={{ left: 74, top: 160, transform: [{ rotate: "-4deg" }] }}>
          <PhotoArea>
            {selfStillUri ? (
              <>
                <Image source={{ uri: selfStillUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                <PhotoTreatment />
              </>
            ) : (
              <PhotoPlaceholder>
                <Feather name="user" size={18} color="#9aa093" />
              </PhotoPlaceholder>
            )}
          </PhotoArea>
          <PolaroidLabel numberOfLines={1}>{selfNickname}</PolaroidLabel>
        </Polaroid>

        <Polaroid style={{ left: 166, top: 164, transform: [{ rotate: "4deg" }] }}>
          <PhotoArea>
            {partnerStillUri ? (
              <>
                <Image source={{ uri: partnerStillUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                <PhotoTreatment />
              </>
            ) : (
              <PhotoPlaceholder>
                <Feather name="user" size={18} color="#9aa093" />
              </PhotoPlaceholder>
            )}
          </PhotoArea>
          <PolaroidLabel numberOfLines={1}>{partnerNickname ?? "Partner"}</PolaroidLabel>
        </Polaroid>

        {/* Hero band: popcorn (left) · script hero · MOVIE NIGHT ticket (right) */}
        <View style={{ position: "absolute", left: 30, top: 252, transform: [{ rotate: "-6deg" }] }}>
          <Popcorn />
        </View>
        <Hero>
          <HeroText numberOfLines={1} adjustsFontSizeToFit>
            movie session
          </HeroText>
        </Hero>
        <View style={{ position: "absolute", right: 18, top: 260, transform: [{ rotate: "8deg" }] }}>
          <Ticket />
        </View>

        {/* Divider swash, tucked close under the headline so they read as a pair */}
        <View style={{ position: "absolute", top: 289, left: 0, right: 0, alignItems: "center" }}>
          <Svg width={150} height={12} viewBox="0 0 150 12">
            <Path d="M4 7 Q 40 1, 78 6 T 146 5" stroke={PALETTE.slate} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          </Svg>
        </View>

        {/* Typed log — flows as a column so a long, two-line title pushes the
            rest down instead of clipping. */}
        <Log>
          <LogRow>
            <RowLabel>Movie</RowLabel>
            <RowValue numberOfLines={2}>{title}</RowValue>
          </LogRow>
          <LogRow>
            <RowLabel>Date</RowLabel>
            <RowValue numberOfLines={1}>{formatDate(dateEpochMs)}</RowValue>
          </LogRow>
          <LogRow>
            <RowLabel>Rating</RowLabel>
            <RatingValue>
              {rating && rating > 0 ? (
                <>
                  <Stars value={rating} />
                  <RatingNum>{rating.toFixed(1)}</RatingNum>
                </>
              ) : (
                <RatingNum>—</RatingNum>
              )}
            </RatingValue>
          </LogRow>
          <LogRow style={{ marginBottom: 0 }}>
            <RowLabel>Genre</RowLabel>
            <RowValue numberOfLines={1}>{formatGenres(genres)}</RowValue>
          </LogRow>
        </Log>
      </Card>
    </ViewShot>
  );
}

const Card = styled(View)`
  width: ${CARD_W}px;
  height: ${CARD_H}px;
  background-color: ${PALETTE.paperTop};
  overflow: hidden;
  border-radius: 4px;
`;

const InnerFrame = styled(View)`
  position: absolute;
  top: 6px;
  left: 6px;
  right: 6px;
  bottom: 6px;
  border-width: 1px;
  border-color: ${PALETTE.frameEdge};
  border-radius: 2px;
`;

const PosterFrame = styled(View)`
  position: absolute;
  top: 12px;
  left: 44px;
  width: 232px;
  height: 166px;
  background-color: ${PALETTE.cream};
  padding: 5px;
  border-width: 1px;
  border-color: ${PALETTE.frameEdge};
`;

const PosterInner = styled(View)`
  flex: 1;
  overflow: hidden;
  background-color: ${PALETTE.posterDark};
  border-width: 1px;
  border-color: ${PALETTE.line};
`;

const Tape = styled(View)`
  position: absolute;
  width: 42px;
  height: 15px;
  background-color: rgba(206, 202, 190, 0.55);
  border-width: 1px;
  border-color: rgba(170, 165, 150, 0.4);
`;

const Polaroid = styled(View)`
  position: absolute;
  width: 80px;
  height: 84px;
  background-color: #f4efe4;
  padding: 6px 6px 0px 6px;
  border-width: 1px;
  border-color: #ded9cc;
`;

const PhotoArea = styled(View)`
  width: 100%;
  height: 58px;
  overflow: hidden;
  background-color: #d3d5cd;
`;

const PhotoPlaceholder = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: #d3d5cd;
`;

const PolaroidLabel = styled(Text)`
  margin-top: 3px;
  text-align: center;
  color: #4a4740;
  font-size: 11px;
  font-family: ${SCRIPT};
`;

const Hero = styled(View)`
  position: absolute;
  top: 256px;
  left: 70px;
  right: 84px;
  height: 34px;
  align-items: center;
  justify-content: center;
`;

const HeroText = styled(Text)`
  color: ${PALETTE.ink};
  font-size: 28px;
  font-family: ${SCRIPT};
  letter-spacing: 0.4px;
`;

const Log = styled(View)`
  position: absolute;
  top: 314px;
  left: 24px;
  right: 24px;
`;

const LogRow = styled(View)`
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: 9px;
`;

const RowLabel = styled(Text)`
  width: 42px;
  color: ${PALETTE.labelFaint};
  font-size: 10.5px;
  line-height: 15px;
  font-family: ${TYPEWRITER};
`;

const RowValue = styled(Text)`
  flex: 1;
  color: ${PALETTE.ink};
  font-size: 11px;
  line-height: 15px;
  font-family: ${TYPEWRITER};
  border-bottom-width: 1px;
  border-bottom-color: ${PALETTE.line};
  padding-bottom: 2px;
`;

const RatingValue = styled(View)`
  flex: 1;
  flex-direction: row;
  align-items: center;
  border-bottom-width: 1px;
  border-bottom-color: ${PALETTE.line};
  padding-bottom: 3px;
`;

const RatingNum = styled(Text)`
  margin-left: 8px;
  color: ${PALETTE.ink};
  font-size: 11px;
  font-family: ${TYPEWRITER};
`;

const TicketMain = styled(Text)`
  position: absolute;
  left: 5px;
  top: 4px;
  width: 38px;
  color: #ffffff;
  font-size: 8px;
  font-family: ${TYPEWRITER};
  text-align: center;
  line-height: 10px;
`;

const TicketStub = styled(Text)`
  position: absolute;
  right: 6px;
  top: 8px;
  color: #ffffff;
  font-size: 11px;
`;

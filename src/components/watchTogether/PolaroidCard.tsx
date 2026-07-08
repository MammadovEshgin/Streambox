import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { RefObject } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Rect } from "react-native-svg";
import ViewShot from "react-native-view-shot";
import styled from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";

// A "Movie Night" memory card rebuilt entirely in code/SVG (no template image),
// so every element is dynamic and controllable. Recreates the vintage scrapbook
// look: aged paper, a framed poster with the movie title, two instant-photo
// frames for the viewers, a filmstrip, a ticket + popcorn, and a MOVIE/DATE/
// NOTES log filled with the film's details.

const CARD_W = 320;
const CARD_H = 430;

const PALETTE = {
  paperTop: "#F1E8D2",
  paperBottom: "#E2D6B8",
  ink: "#2E2A20",
  inkSoft: "#6E6552",
  tan: "#C2B187",
  tanDeep: "#A9946A",
  red: "#B24230",
  blue: "#33668A",
  cream: "#F5EFDD",
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
  synopsis?: string | null;
};

function titleFontSize(title: string): number {
  const len = title.trim().length;
  if (len <= 7) return 34;
  if (len <= 11) return 28;
  if (len <= 16) return 23;
  if (len <= 22) return 18;
  return 15;
}

function formatDate(epochMs: number): string {
  try {
    return new Date(epochMs)
      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      .toUpperCase();
  } catch {
    return "";
  }
}

function toSynopsis(text?: string | null): string {
  if (!text) return "";
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  let out = sentences.slice(0, 3).join(" ");
  if (out.length > 175) out = `${out.slice(0, 172).trimEnd()}…`;
  return out;
}

function Filmstrip() {
  const holes = Array.from({ length: 9 });
  return (
    <Svg width={24} height={232} viewBox="0 0 24 232">
      <Rect x={0} y={0} width={24} height={232} rx={2} fill="#15130f" />
      {holes.map((_, i) => (
        <Rect key={`l${i}`} x={2.5} y={7 + i * 25} width={4.5} height={9} rx={1.5} fill="#efe7d0" />
      ))}
      {holes.map((_, i) => (
        <Rect key={`r${i}`} x={17} y={7 + i * 25} width={4.5} height={9} rx={1.5} fill="#efe7d0" />
      ))}
      {holes.map((_, i) => (
        <Line key={`f${i}`} x1={9} y1={4 + i * 25} x2={15} y2={4 + i * 25} stroke="#3a352c" strokeWidth={0.7} />
      ))}
    </Svg>
  );
}

function Star({ size = 12, color = PALETTE.red }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="12,1 15,9 23,9 16,14 19,23 12,17 5,23 8,14 1,9 9,9" fill={color} />
    </Svg>
  );
}

function Ticket() {
  return (
    <View style={{ width: 50, height: 28 }}>
      <Svg width={50} height={28} viewBox="0 0 50 28" style={{ position: "absolute" }}>
        <Rect x={0.5} y={0.5} width={49} height={27} rx={3.5} fill={PALETTE.red} stroke="#7c2b1f" strokeWidth={1} />
        <Line x1={35} y1={3} x2={35} y2={25} stroke="#eac7bf" strokeWidth={1} strokeDasharray="2 2" />
        <Circle cx={35} cy={0} r={2.5} fill={PALETTE.paperTop} />
        <Circle cx={35} cy={28} r={2.5} fill={PALETTE.paperTop} />
      </Svg>
      <TicketMain>MOVIE{"\n"}NIGHT</TicketMain>
      <TicketSide>★</TicketSide>
    </View>
  );
}

function Popcorn() {
  return (
    <Svg width={46} height={50} viewBox="0 0 46 50">
      {[
        [12, 12],
        [20, 7],
        [28, 11],
        [34, 16],
        [16, 16],
        [24, 14],
        [10, 18],
        [30, 6],
      ].map(([cx, cy], i) => (
        <Circle key={i} cx={cx} cy={cy} r={4.4} fill={i % 2 ? "#F0DA92" : "#E7C86C"} />
      ))}
      <Polygon points="7,19 39,19 35,49 11,49" fill={PALETTE.cream} stroke="#c1452f" strokeWidth={1.2} />
      <Polygon points="14,19 18,19 16.5,49 12.5,49" fill="#c1452f" />
      <Polygon points="22,19 26,19 25.5,49 22.5,49" fill="#c1452f" />
      <Polygon points="30,19 34,19 34.2,49 31.5,49" fill="#c1452f" />
    </Svg>
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
  synopsis,
}: PolaroidCardProps) {
  const posterSource = posterPath ?? backdropPath ?? null;
  const poster = posterSource ? getTmdbImageUrl(posterSource, "w500") : null;

  return (
    <ViewShot ref={viewShotRef} options={{ format: "png", quality: 1 }}>
      <Card>
        <LinearGradient
          colors={[PALETTE.paperTop, PALETTE.paperBottom]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <InnerFrame />

        {/* Filmstrip down the left */}
        <View style={{ position: "absolute", left: 12, top: 26, transform: [{ rotate: "-3deg" }] }}>
          <Filmstrip />
        </View>

        {/* Poster + title */}
        <PosterFrame>
          <PosterInner>
            {poster ? (
              <Image source={{ uri: poster }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <View style={{ flex: 1, backgroundColor: PALETTE.posterDark }} />
            )}
            <LinearGradient
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.55)"]}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />
            <TitleWrap>
              <TitleText numberOfLines={3} adjustsFontSizeToFit style={{ fontSize: titleFontSize(title) }}>
                {title.toUpperCase()}
              </TitleText>
            </TitleWrap>
          </PosterInner>
        </PosterFrame>

        {/* Tape on the poster corners */}
        <Tape style={{ left: 40, top: 12, transform: [{ rotate: "-24deg" }] }} />
        <Tape style={{ right: 40, top: 12, transform: [{ rotate: "22deg" }] }} />

        {/* Ticket */}
        <View style={{ position: "absolute", right: 14, top: 150, transform: [{ rotate: "9deg" }] }}>
          <Ticket />
        </View>

        {/* Viewer instant photos */}
        <Polaroid style={{ left: 62, top: 150, transform: [{ rotate: "-5deg" }] }}>
          <PhotoArea>
            {selfStillUri ? (
              <Image source={{ uri: selfStillUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <PhotoPlaceholder>
                <Feather name="user" size={20} color="#9aa093" />
              </PhotoPlaceholder>
            )}
          </PhotoArea>
          <PolaroidLabel numberOfLines={1}>{selfNickname}</PolaroidLabel>
        </Polaroid>

        <Polaroid style={{ left: 168, top: 150, transform: [{ rotate: "5deg" }] }}>
          <PhotoArea>
            {partnerStillUri ? (
              <Image source={{ uri: partnerStillUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <PhotoPlaceholder>
                <Feather name="user" size={20} color="#9aa093" />
              </PhotoPlaceholder>
            )}
          </PhotoArea>
          <PolaroidLabel numberOfLines={1}>{partnerNickname ?? "Partner"}</PolaroidLabel>
        </Polaroid>

        {/* Header */}
        <Header>
          <View style={{ marginRight: 8 }}>
            <Star size={11} />
          </View>
          <HeaderText>MOVIE NIGHT</HeaderText>
          <View style={{ marginLeft: 8 }}>
            <Star size={11} />
          </View>
        </Header>
        <View style={{ position: "absolute", top: 286, alignSelf: "center" }}>
          <Svg width={150} height={12} viewBox="0 0 150 12">
            <Path d="M4 7 Q 40 1, 78 6 T 146 5" stroke={PALETTE.blue} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          </Svg>
        </View>

        {/* Log */}
        <Row style={{ top: 306 }}>
          <MaterialCommunityIcons name="movie-open-outline" size={13} color={PALETTE.ink} />
          <RowLabel>MOVIE</RowLabel>
          <RowValue numberOfLines={1}>{title}</RowValue>
        </Row>
        <Row style={{ top: 332 }}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={13} color={PALETTE.ink} />
          <RowLabel>DATE</RowLabel>
          <DateValue numberOfLines={1}>{formatDate(dateEpochMs)}</DateValue>
        </Row>
        <Row style={{ top: 358 }}>
          <MaterialCommunityIcons name="note-text-outline" size={13} color={PALETTE.ink} />
          <RowLabel>NOTES</RowLabel>
        </Row>
        <NotesText numberOfLines={4}>{toSynopsis(synopsis)}</NotesText>

        {/* Popcorn */}
        <View style={{ position: "absolute", right: 12, bottom: 8 }}>
          <Popcorn />
        </View>
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
  border-color: ${PALETTE.tanDeep};
  border-radius: 2px;
`;

const PosterFrame = styled(View)`
  position: absolute;
  top: 18px;
  left: 44px;
  width: 232px;
  height: 166px;
  background-color: ${PALETTE.cream};
  padding: 5px;
  border-width: 1px;
  border-color: ${PALETTE.tanDeep};
`;

const PosterInner = styled(View)`
  flex: 1;
  overflow: hidden;
  background-color: ${PALETTE.posterDark};
  border-width: 1px;
  border-color: ${PALETTE.tan};
`;

const TitleWrap = styled(View)`
  position: absolute;
  top: 14%;
  left: 6%;
  right: 6%;
  height: 62%;
  align-items: center;
  justify-content: center;
`;

const TitleText = styled(Text)`
  color: ${PALETTE.cream};
  font-weight: 900;
  text-align: center;
  letter-spacing: 1.2px;
  text-shadow: 0px 1px 4px rgba(0, 0, 0, 0.65);
`;

const Tape = styled(View)`
  position: absolute;
  width: 44px;
  height: 16px;
  background-color: rgba(214, 199, 160, 0.55);
  border-width: 1px;
  border-color: rgba(180, 165, 128, 0.4);
`;

const Polaroid = styled(View)`
  position: absolute;
  width: 90px;
  height: 100px;
  background-color: #f6f1e3;
  padding: 6px 6px 0px 6px;
  border-width: 1px;
  border-color: #ded3ba;
`;

const PhotoArea = styled(View)`
  width: 100%;
  height: 66px;
  overflow: hidden;
  background-color: #cfd3c8;
`;

const PhotoPlaceholder = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: #cfd3c8;
`;

const PolaroidLabel = styled(Text)`
  margin-top: 5px;
  text-align: center;
  color: #4a4436;
  font-size: 10px;
  font-style: italic;
  font-weight: 600;
`;

const Header = styled(View)`
  position: absolute;
  top: 262px;
  left: 0;
  right: 0;
  flex-direction: row;
  align-items: center;
  justify-content: center;
`;

const HeaderText = styled(Text)`
  color: ${PALETTE.ink};
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 1.5px;
`;

const Row = styled(View)`
  position: absolute;
  left: 22px;
  right: 22px;
  flex-direction: row;
  align-items: center;
`;

const RowLabel = styled(Text)`
  margin-left: 7px;
  width: 48px;
  color: ${PALETTE.ink};
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.8px;
`;

const RowValue = styled(Text)`
  flex: 1;
  color: ${PALETTE.inkSoft};
  font-size: 12px;
  font-weight: 600;
  border-bottom-width: 1px;
  border-bottom-color: ${PALETTE.tan};
  padding-bottom: 2px;
`;

const DateValue = styled(Text)`
  flex: 1;
  text-align: right;
  color: ${PALETTE.red};
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
  border-bottom-width: 1px;
  border-bottom-color: ${PALETTE.tan};
  padding-bottom: 2px;
`;

const NotesText = styled(Text)`
  position: absolute;
  top: 380px;
  left: 22px;
  right: 60px;
  color: ${PALETTE.inkSoft};
  font-size: 9px;
  line-height: 13px;
`;

const TicketMain = styled(Text)`
  position: absolute;
  left: 4px;
  top: 4px;
  width: 30px;
  color: #ffffff;
  font-size: 8px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.5px;
`;

const TicketSide = styled(Text)`
  position: absolute;
  right: 3px;
  top: 7px;
  color: #ffffff;
  font-size: 11px;
`;

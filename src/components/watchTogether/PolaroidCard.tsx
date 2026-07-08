import { Image } from "expo-image";
import type { RefObject } from "react";
import { Text, View } from "react-native";
import ViewShot from "react-native-view-shot";
import styled from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";

// The template is a full opaque design (aged paper + frame + labels). So the
// dynamic content is layered ON TOP of it: the movie poster covers the baked
// "MOVIE TITLE" art inside the frame, the two camera stills cover the VIEWER
// placeholders, and the form values are written over the MOVIE / DATE / NOTES
// lines. All positions are percentages of the card so the whole thing scales.
//
// NOTE: coordinates are eyeballed from the 1122x1402 template and may want a
// small tuning pass on-device — they're grouped here for easy adjustment.
const TEMPLATE = require("../../../assets/polaroid-template.webp");

const CARD_WIDTH = 320;
const CARD_HEIGHT = 400; // template aspect is 1024x1280 = 0.8

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

// Bigger name → smaller type. adjustsFontSizeToFit then does the fine shrink.
function titleFontSize(title: string): number {
  const len = title.trim().length;
  if (len <= 8) return 30;
  if (len <= 13) return 25;
  if (len <= 18) return 20;
  if (len <= 26) return 16;
  return 13;
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

// First 2–3 sentences of the overview, capped so it fits the notes lines.
function toSynopsis(text?: string | null): string {
  if (!text) return "";
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  let out = sentences.slice(0, 3).join(" ");
  if (out.length > 190) out = `${out.slice(0, 187).trimEnd()}…`;
  return out;
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
        <Template source={TEMPLATE} contentFit="cover" />

        {/* Movie poster fills the framed poster region (covers baked art + title) */}
        {poster ? <Poster source={{ uri: poster }} contentFit="cover" /> : null}
        <TitleScrim />
        <TitleWrap>
          <TitleText numberOfLines={2} adjustsFontSizeToFit style={{ fontSize: titleFontSize(title) }}>
            {title.toUpperCase()}
          </TitleText>
        </TitleWrap>

        {/* Viewer photos */}
        {selfStillUri ? <Photo1 source={{ uri: selfStillUri }} contentFit="cover" /> : null}
        {partnerStillUri ? <Photo2 source={{ uri: partnerStillUri }} contentFit="cover" /> : null}

        {/* Nicknames over the VIEWER 1 / VIEWER 2 labels */}
        <Name1Patch />
        <Name1 numberOfLines={1}>{selfNickname}</Name1>
        <Name2Patch />
        <Name2 numberOfLines={1}>{partnerNickname ?? ""}</Name2>

        {/* Form values */}
        <MovieField numberOfLines={1}>{title}</MovieField>
        <DatePatch />
        <DateField numberOfLines={1}>{formatDate(dateEpochMs)}</DateField>
        <NotesField numberOfLines={4}>{toSynopsis(synopsis)}</NotesField>
      </Card>
    </ViewShot>
  );
}

const PAPER = "#ECE5D2";
const INK = "#403a2d";

const Card = styled(View)`
  width: ${CARD_WIDTH}px;
  height: ${CARD_HEIGHT}px;
  background-color: ${PAPER};
`;

const Template = styled(Image)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`;

const Poster = styled(Image)`
  position: absolute;
  top: 8%;
  left: 24.5%;
  width: 53%;
  height: 40.5%;
`;

const TitleScrim = styled(View)`
  position: absolute;
  top: 8%;
  left: 24.5%;
  width: 53%;
  height: 40.5%;
  background-color: rgba(10, 12, 16, 0.28);
`;

const TitleWrap = styled(View)`
  position: absolute;
  top: 14%;
  left: 25%;
  width: 52%;
  height: 20%;
  align-items: center;
  justify-content: center;
`;

const TitleText = styled(Text)`
  color: #f4efe1;
  font-weight: 800;
  text-align: center;
  letter-spacing: 1px;
  text-shadow: 0px 1px 3px rgba(0, 0, 0, 0.6);
`;

const Photo1 = styled(Image)`
  position: absolute;
  top: 52.5%;
  left: 28.7%;
  width: 15.6%;
  height: 12.5%;
`;

const Photo2 = styled(Image)`
  position: absolute;
  top: 52.5%;
  left: 53%;
  width: 15.6%;
  height: 12.5%;
`;

const Name1Patch = styled(View)`
  position: absolute;
  top: 65.2%;
  left: 27%;
  width: 19%;
  height: 3%;
  background-color: ${PAPER};
`;

const Name2Patch = styled(View)`
  position: absolute;
  top: 65.2%;
  left: 51.4%;
  width: 19%;
  height: 3%;
  background-color: ${PAPER};
`;

const Name1 = styled(Text)`
  position: absolute;
  top: 65.5%;
  left: 27%;
  width: 19%;
  text-align: center;
  color: ${INK};
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.5px;
`;

const Name2 = styled(Text)`
  position: absolute;
  top: 65.5%;
  left: 51.4%;
  width: 19%;
  text-align: center;
  color: ${INK};
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.5px;
`;

const MovieField = styled(Text)`
  position: absolute;
  top: 79.6%;
  left: 30%;
  width: 57%;
  color: ${INK};
  font-size: 9px;
  font-weight: 700;
`;

const DatePatch = styled(View)`
  position: absolute;
  top: 84%;
  left: 58%;
  width: 32%;
  height: 4%;
  background-color: ${PAPER};
`;

const DateField = styled(Text)`
  position: absolute;
  top: 84.3%;
  left: 58%;
  width: 31%;
  text-align: right;
  color: #b23a2a;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.5px;
`;

const NotesField = styled(Text)`
  position: absolute;
  top: 88.6%;
  left: 30%;
  width: 57%;
  height: 9%;
  color: ${INK};
  font-size: 6.5px;
  line-height: 9px;
`;

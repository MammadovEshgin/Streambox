import { Image } from "expo-image";
import type { RefObject } from "react";
import { Text, View } from "react-native";
import ViewShot from "react-native-view-shot";
import styled from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";

// The polaroid is composed from camera STILLS (never a screenshot of the movie
// or the live camera texture). Rasterized to PNG with react-native-view-shot —
// the same captureRef → Sharing pattern used by the stats persona card.

export type PolaroidCardProps = {
  viewShotRef?: RefObject<ViewShot | null>;
  backdropPath?: string | null;
  title: string;
  timecodeSeconds: number;
  dateEpochMs: number;
  selfStillUri?: string | null;
  partnerStillUri?: string | null;
  selfNickname: string;
  partnerNickname?: string | null;
  caption?: string | null;
};

function formatTimecode(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDate(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function PolaroidCard({
  viewShotRef,
  backdropPath,
  title,
  timecodeSeconds,
  dateEpochMs,
  selfStillUri,
  partnerStillUri,
  selfNickname,
  partnerNickname,
  caption,
}: PolaroidCardProps) {
  const backdrop = backdropPath ? getTmdbImageUrl(backdropPath, "w780") : null;
  const names = [selfNickname, partnerNickname].filter(Boolean).join("  &  ");

  return (
    <ViewShot ref={viewShotRef} options={{ format: "png", quality: 1 }}>
      <Frame>
        <Photo>
          {backdrop ? (
            <BackdropImage source={{ uri: backdrop }} contentFit="cover" transition={0} />
          ) : (
            <BackdropFallback />
          )}
          <PhotoScrim />
          <Faces>
            <FaceBubble>
              {selfStillUri ? <FaceImage source={{ uri: selfStillUri }} contentFit="cover" /> : <FaceEmpty />}
            </FaceBubble>
            <FaceBubble>
              {partnerStillUri ? <FaceImage source={{ uri: partnerStillUri }} contentFit="cover" /> : <FaceEmpty />}
            </FaceBubble>
          </Faces>
          <TimeChip>
            <TimeChipText>{formatTimecode(timecodeSeconds)}</TimeChipText>
          </TimeChip>
        </Photo>

        <Caption>
          <MovieTitle numberOfLines={1}>{title}</MovieTitle>
          <Names numberOfLines={1}>{names}</Names>
          {caption ? <CaptionText numberOfLines={2}>{`“${caption}”`}</CaptionText> : null}
          <FooterRow>
            <FooterText>Watched together</FooterText>
            <FooterDot />
            <FooterText>{formatDate(dateEpochMs)}</FooterText>
          </FooterRow>
          <Brand>StreamBox</Brand>
        </Caption>
      </Frame>
    </ViewShot>
  );
}

const FRAME_WIDTH = 300;
const PHOTO_HEIGHT = 300;

const Frame = styled(View)`
  width: ${FRAME_WIDTH}px;
  background-color: #f7f6f1;
  padding: 12px 12px 0px 12px;
  border-radius: 6px;
`;

const Photo = styled(View)`
  width: 100%;
  height: ${PHOTO_HEIGHT}px;
  background-color: #10110f;
  overflow: hidden;
  border-radius: 2px;
`;

const BackdropImage = styled(Image)`
  width: 100%;
  height: 100%;
`;

const BackdropFallback = styled(View)`
  width: 100%;
  height: 100%;
  background-color: #1b211e;
`;

const PhotoScrim = styled(View)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 60%;
  background-color: rgba(0, 0, 0, 0.28);
`;

const Faces = styled(View)`
  position: absolute;
  top: 12px;
  right: 12px;
  flex-direction: row;
  gap: 8px;
`;

const FaceBubble = styled(View)`
  width: 64px;
  height: 64px;
  border-radius: 32px;
  border-width: 3px;
  border-color: #ffffff;
  overflow: hidden;
  background-color: #232a26;
`;

const FaceImage = styled(Image)`
  width: 100%;
  height: 100%;
`;

const FaceEmpty = styled(View)`
  width: 100%;
  height: 100%;
  background-color: #2a312d;
`;

const TimeChip = styled(View)`
  position: absolute;
  left: 12px;
  bottom: 12px;
  background-color: rgba(0, 0, 0, 0.55);
  padding: 4px 10px;
  border-radius: 999px;
`;

const TimeChipText = styled(Text)`
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
`;

const Caption = styled(View)`
  padding: 12px 4px 14px 4px;
`;

const MovieTitle = styled(Text)`
  color: #1a1a17;
  font-size: 17px;
  font-weight: 800;
`;

const Names = styled(Text)`
  color: #55635a;
  font-size: 13px;
  font-weight: 600;
  margin-top: 2px;
`;

const CaptionText = styled(Text)`
  color: #7a4a2a;
  font-size: 13px;
  font-style: italic;
  margin-top: 6px;
`;

const FooterRow = styled(View)`
  flex-direction: row;
  align-items: center;
  margin-top: 10px;
`;

const FooterText = styled(Text)`
  color: #8a938b;
  font-size: 11px;
  letter-spacing: 0.4px;
`;

const FooterDot = styled(View)`
  width: 3px;
  height: 3px;
  border-radius: 2px;
  background-color: #b7bdb5;
  margin: 0px 6px;
`;

const Brand = styled(Text)`
  position: absolute;
  right: 4px;
  bottom: 14px;
  color: #b7bdb5;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
`;

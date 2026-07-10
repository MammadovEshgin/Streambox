import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { MediaStream } from "react-native-webrtc";
import styled from "styled-components/native";

import { getWebRtc } from "../../services/webrtcCompat";

// Two square "screen" tiles hugging the left edge — partner on top, you below.
// Styled like little cinema monitors (warm amber frame, soft glow, a glassy
// sheen, a LIVE dot + name plate) so they feel like part of a movie room rather
// than plain webcam bubbles. Hidden until the cameras are on; shown as
// placeholders in Expo Go (no native WebRTC).

export type FaceCamOverlayProps = {
  visible: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  selfNickname: string;
  partnerNickname?: string | null;
  cameraEnabled: boolean;
  partnerConnected: boolean;
};

const BOX_SIZE = 122;
const STREAM_STYLE = { width: "100%" as const, height: "100%" as const };

export function FaceCamOverlay({
  visible,
  localStream,
  remoteStream,
  selfNickname,
  partnerNickname,
  cameraEnabled,
  partnerConnected,
}: FaceCamOverlayProps) {
  const RTCView = getWebRtc()?.RTCView;
  if (!visible) return null;

  const partnerLive = Boolean(RTCView && remoteStream && partnerConnected);
  const selfLive = Boolean(RTCView && localStream && cameraEnabled);

  return (
    <Column pointerEvents="none">
      <Box>
        <Screen>
          {RTCView && remoteStream && partnerConnected ? (
            <RTCView streamURL={remoteStream.toURL()} style={STREAM_STYLE} objectFit="cover" mirror={false} />
          ) : (
            <Placeholder>
              <Feather name="user" size={22} color="#8A938B" />
            </Placeholder>
          )}
          <Sheen colors={["rgba(255,255,255,0.10)", "transparent", "rgba(0,0,0,0.22)"]} locations={[0, 0.42, 1]} />
        </Screen>
        {partnerLive ? (
          <LiveTag>
            <LiveDot />
            <LiveLabel>LIVE</LiveLabel>
          </LiveTag>
        ) : null}
        <NamePlate>
          <NameChip>
            <NameTag numberOfLines={1}>{partnerNickname ?? "Partner"}</NameTag>
          </NameChip>
        </NamePlate>
      </Box>

      <Box>
        <Screen>
          {RTCView && localStream && cameraEnabled ? (
            <RTCView streamURL={localStream.toURL()} style={STREAM_STYLE} objectFit="cover" mirror />
          ) : (
            <Placeholder>
              <Feather name={cameraEnabled ? "user" : "video-off"} size={22} color="#8A938B" />
            </Placeholder>
          )}
          <Sheen colors={["rgba(255,255,255,0.10)", "transparent", "rgba(0,0,0,0.22)"]} locations={[0, 0.42, 1]} />
        </Screen>
        {selfLive ? (
          <LiveTag>
            <LiveDot />
            <LiveLabel>LIVE</LiveLabel>
          </LiveTag>
        ) : null}
        <NamePlate>
          <NameChip>
            <NameTag numberOfLines={1}>{selfNickname}</NameTag>
          </NameChip>
        </NamePlate>
      </Box>
    </Column>
  );
}

const Column = styled(View)`
  position: absolute;
  left: 10px;
  top: 0;
  bottom: 0;
  justify-content: center;
`;

// A plain rounded video tile — no frame, no accent colour.
const Box = styled(View)`
  width: ${BOX_SIZE}px;
  height: ${BOX_SIZE}px;
  margin: 8px 0;
  border-radius: 18px;
  background-color: #10110f;
`;

const Screen = styled(View)`
  flex: 1;
  border-radius: 18px;
  overflow: hidden;
  background-color: #10110f;
`;

const Placeholder = styled(View)`
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-color: #1b211e;
`;

const Sheen = styled(LinearGradient)`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
`;

const LiveTag = styled(View)`
  position: absolute;
  top: 8px;
  left: 8px;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background-color: rgba(0, 0, 0, 0.55);
`;

const LiveDot = styled(View)`
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: #ff5245;
`;

const LiveLabel = styled(Text)`
  color: #ffffff;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1px;
`;

const NamePlate = styled(View)`
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  align-items: center;
`;

const NameChip = styled(View)`
  max-width: 90%;
  padding: 3px 10px;
  border-radius: 999px;
  background-color: rgba(13, 16, 15, 0.8);
`;

const NameTag = styled(Text)`
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.85);
`;

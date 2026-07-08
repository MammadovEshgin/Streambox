import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import type { MediaStream } from "react-native-webrtc";
import styled from "styled-components/native";

import { getWebRtc } from "../../services/webrtcCompat";

// Two circular face bubbles hugging the right edge (10px margin) — partner on
// top, you below. Hidden until the user turns the cameras on, and shown as
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

  return (
    <Column pointerEvents="none">
      <Bubble>
        {RTCView && remoteStream && partnerConnected ? (
          <RTCView streamURL={remoteStream.toURL()} style={STREAM_STYLE} objectFit="cover" mirror={false} />
        ) : (
          <Placeholder>
            <Feather name="user" size={16} color="#8A938B" />
          </Placeholder>
        )}
        <NameTag numberOfLines={1}>{partnerNickname ?? "Partner"}</NameTag>
      </Bubble>

      <Bubble>
        {RTCView && localStream && cameraEnabled ? (
          <RTCView streamURL={localStream.toURL()} style={STREAM_STYLE} objectFit="cover" mirror />
        ) : (
          <Placeholder>
            <Feather name={cameraEnabled ? "user" : "video-off"} size={16} color="#8A938B" />
          </Placeholder>
        )}
        <NameTag numberOfLines={1}>{selfNickname}</NameTag>
      </Bubble>
    </Column>
  );
}

const BUBBLE_SIZE = 88;

const Column = styled(View)`
  position: absolute;
  right: 10px;
  top: 0;
  bottom: 0;
  justify-content: center;
`;

const Bubble = styled(View)`
  width: ${BUBBLE_SIZE}px;
  height: ${BUBBLE_SIZE}px;
  border-radius: ${BUBBLE_SIZE / 2}px;
  margin: 7px 0;
  overflow: hidden;
  background-color: #10110f;
  border-width: 1.5px;
  border-color: rgba(255, 255, 255, 0.9);
`;

const Placeholder = styled(View)`
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-color: #1b211e;
`;

const NameTag = styled(Text)`
  position: absolute;
  bottom: 6px;
  align-self: center;
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.85);
`;

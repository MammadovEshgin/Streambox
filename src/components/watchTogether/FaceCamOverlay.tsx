import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { RTCView, type MediaStream } from "react-native-webrtc";
import styled from "styled-components/native";

// Two face tiles pinned to the right edge — partner top-right, you bottom-right
// — each ~30% of the screen width, leaving the rest for the movie.

export type FaceCamOverlayProps = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  selfNickname: string;
  partnerNickname?: string | null;
  cameraEnabled: boolean;
  partnerConnected: boolean;
};

export function FaceCamOverlay({
  localStream,
  remoteStream,
  selfNickname,
  partnerNickname,
  cameraEnabled,
  partnerConnected,
}: FaceCamOverlayProps) {
  return (
    <Column pointerEvents="none">
      <Tile>
        {remoteStream && partnerConnected ? (
          <Stream streamURL={remoteStream.toURL()} objectFit="cover" mirror={false} />
        ) : (
          <Placeholder>
            <Feather name="user" size={22} color="#8A938B" />
            <PlaceholderText>{partnerConnected ? "…" : "Waiting"}</PlaceholderText>
          </Placeholder>
        )}
        <NameTag numberOfLines={1}>{partnerNickname ?? "Partner"}</NameTag>
      </Tile>

      <Tile>
        {localStream && cameraEnabled ? (
          <Stream streamURL={localStream.toURL()} objectFit="cover" mirror />
        ) : (
          <Placeholder>
            <Feather name={cameraEnabled ? "user" : "video-off"} size={22} color="#8A938B" />
          </Placeholder>
        )}
        <NameTag numberOfLines={1}>{selfNickname}</NameTag>
      </Tile>
    </Column>
  );
}

const Column = styled(View)`
  position: absolute;
  top: 0;
  bottom: 0;
  right: 10px;
  justify-content: space-between;
  padding-top: 14px;
  padding-bottom: 14px;
`;

const Tile = styled(View)`
  width: 30%;
  aspect-ratio: 0.72;
  min-width: 120px;
  border-radius: 16px;
  overflow: hidden;
  background-color: #10110f;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.12);
`;

const Stream = styled(RTCView)`
  width: 100%;
  height: 100%;
`;

const Placeholder = styled(View)`
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-color: #1b211e;
`;

const PlaceholderText = styled(Text)`
  color: #8a938b;
  font-size: 11px;
  margin-top: 4px;
`;

const NameTag = styled(Text)`
  position: absolute;
  left: 8px;
  bottom: 6px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.8);
`;

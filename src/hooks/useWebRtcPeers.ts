import { useCallback, useEffect, useRef, useState } from "react";
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";

import { fetchIceServers } from "../services/turnCredentials";
import type { WatchRoomSignal } from "../utils/watchRoom";

// ---------------------------------------------------------------------------
// Two-person WebRTC face-cam/audio. Because a room is exactly 2 people we use a
// direct peer connection (no SFU): lowest latency, lowest cost. Only the host
// sends the initial offer, so there is no glare/collision to arbitrate. The
// signaling messages (offer/answer/ICE) ride the room's Realtime channel via
// `sendSignal`; the media itself flows phone-to-phone.
// ---------------------------------------------------------------------------

type WebrtcSignal = Extract<WatchRoomSignal, { type: "webrtc-offer" | "webrtc-answer" | "webrtc-ice" }>;

export type PeerConnectionState = "idle" | "connecting" | "connected" | "failed" | "closed";

type Options = {
  // Turn the media layer on only once both participants are in the session.
  enabled: boolean;
  // The host offers; the guest answers.
  isInitiator: boolean;
  selfUserId: string;
  sendSignal: (signal: WatchRoomSignal) => void;
};

export function useWebRtcPeers({ enabled, isInitiator, selfUserId, sendSignal }: Options) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<PeerConnectionState>("idle");
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteDescSetRef = useRef(false);
  const pendingCandidatesRef = useRef<any[]>([]);
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const pending = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of pending) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }, []);

  // Route an incoming webrtc signal from the room channel into the peer.
  const handleSignal = useCallback(
    async (signal: WebrtcSignal) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (signal.type === "webrtc-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp }));
          remoteDescSetRef.current = true;
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalRef.current({ type: "webrtc-answer", from: selfUserId, sdp: answer.sdp });
        } else if (signal.type === "webrtc-answer") {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }));
          remoteDescSetRef.current = true;
          await flushPendingCandidates();
        } else if (signal.type === "webrtc-ice") {
          if (remoteDescSetRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => undefined);
          } else {
            pendingCandidatesRef.current.push(signal.candidate);
          }
        }
      } catch {
        setConnectionState("failed");
      }
    },
    [flushPendingCandidates, selfUserId]
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function setup() {
      setConnectionState("connecting");
      const iceServers = await fetchIceServers();
      if (cancelled) return;

      const stream = await mediaDevices
        .getUserMedia({ audio: true, video: { facingMode: "user" } })
        .catch(() => null);
      if (cancelled || !stream) {
        setConnectionState("failed");
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event: any) => {
        if (event?.candidate) {
          sendSignalRef.current({ type: "webrtc-ice", from: selfUserId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event: any) => {
        const incoming: MediaStream = event?.streams?.[0] ?? new MediaStream();
        if (!event?.streams?.[0] && event?.track) {
          incoming.addTrack(event.track);
        }
        setRemoteStream(incoming);
      };

      pc.onconnectionstatechange = () => {
        const cs = pc.connectionState;
        if (cs === "connected") setConnectionState("connected");
        else if (cs === "failed") setConnectionState("failed");
        else if (cs === "closed") setConnectionState("closed");
      };

      // Only the host kicks off the negotiation; the guest waits for the offer.
      if (isInitiator) {
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        sendSignalRef.current({ type: "webrtc-offer", from: selfUserId, sdp: offer.sdp });
      }
    }

    void setup();

    return () => {
      cancelled = true;
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((track: any) => track.stop?.());
      localStreamRef.current = null;
      remoteDescSetRef.current = false;
      pendingCandidatesRef.current = [];
      setLocalStream(null);
      setRemoteStream(null);
      setConnectionState("closed");
    };
  }, [enabled, isInitiator, selfUserId]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micEnabled;
    stream.getAudioTracks().forEach((track: any) => (track.enabled = next));
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraEnabled;
    stream.getVideoTracks().forEach((track: any) => (track.enabled = next));
    setCameraEnabled(next);
  }, [cameraEnabled]);

  const switchCamera = useCallback(() => {
    const stream = localStreamRef.current;
    stream?.getVideoTracks().forEach((track: any) => track._switchCamera?.());
  }, []);

  return {
    localStream,
    remoteStream,
    connectionState,
    micEnabled,
    cameraEnabled,
    handleSignal,
    toggleMic,
    toggleCamera,
    switchCamera,
  };
}

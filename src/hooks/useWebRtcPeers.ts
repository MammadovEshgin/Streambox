import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaStream, RTCPeerConnection } from "react-native-webrtc";

import { getWebRtc, isWebRtcAvailable } from "../services/webrtcCompat";
import { fetchIceServers } from "../services/turnCredentials";
import type { WatchRoomSignal } from "../utils/watchRoom";

// ---------------------------------------------------------------------------
// Two-person WebRTC face-cam/audio. Because a room is exactly 2 people we use a
// direct peer connection (no SFU): lowest latency, lowest cost. Only the host
// sends the initial offer, so there is no glare/collision to arbitrate. The
// signaling messages (offer/answer/ICE) ride the room's Realtime channel via
// `sendSignal`; the media itself flows phone-to-phone.
//
// The native module is absent in Expo Go — there the hook reports "unavailable"
// and produces no streams, and the UI falls back to placeholder tiles.
// ---------------------------------------------------------------------------

type WebrtcSignal = Extract<WatchRoomSignal, { type: "webrtc-offer" | "webrtc-answer" | "webrtc-ice" }>;

export type PeerConnectionState = "idle" | "unavailable" | "connecting" | "connected" | "failed" | "closed";

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
  const [connectionState, setConnectionState] = useState<PeerConnectionState>(
    isWebRtcAvailable ? "idle" : "unavailable"
  );
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteDescSetRef = useRef(false);
  const pendingCandidatesRef = useRef<any[]>([]);
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  const flushPendingCandidates = useCallback(async () => {
    const webrtc = getWebRtc();
    const pc = pcRef.current;
    if (!webrtc || !pc) return;
    const pending = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of pending) {
      await pc.addIceCandidate(new webrtc.RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }, []);

  // Route an incoming webrtc signal from the room channel into the peer.
  const handleSignal = useCallback(
    async (signal: WebrtcSignal) => {
      const webrtc = getWebRtc();
      const pc = pcRef.current;
      if (!webrtc || !pc) return;
      try {
        if (signal.type === "webrtc-offer") {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription({ type: "offer", sdp: signal.sdp }));
          remoteDescSetRef.current = true;
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalRef.current({ type: "webrtc-answer", from: selfUserId, sdp: answer.sdp });
        } else if (signal.type === "webrtc-answer") {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription({ type: "answer", sdp: signal.sdp }));
          remoteDescSetRef.current = true;
          await flushPendingCandidates();
        } else if (signal.type === "webrtc-ice") {
          if (remoteDescSetRef.current) {
            await pc.addIceCandidate(new webrtc.RTCIceCandidate(signal.candidate as any)).catch(() => undefined);
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
    const webrtc = getWebRtc();
    if (!webrtc) {
      setConnectionState("unavailable");
      return;
    }

    let cancelled = false;

    async function setup() {
      const { RTCPeerConnection: PC, MediaStream: MS, mediaDevices } = webrtc!;
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

      const pc = new PC({ iceServers });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      (pc as any).onicecandidate = (event: any) => {
        if (event?.candidate) {
          sendSignalRef.current({ type: "webrtc-ice", from: selfUserId, candidate: event.candidate });
        }
      };

      (pc as any).ontrack = (event: any) => {
        const incoming: MediaStream = event?.streams?.[0] ?? new MS();
        if (!event?.streams?.[0] && event?.track) {
          incoming.addTrack(event.track);
        }
        setRemoteStream(incoming);
      };

      (pc as any).onconnectionstatechange = () => {
        const cs = (pc as any).connectionState;
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
      setConnectionState(isWebRtcAvailable ? "closed" : "unavailable");
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
    webrtcAvailable: isWebRtcAvailable,
    micEnabled,
    cameraEnabled,
    handleSignal,
    toggleMic,
    toggleCamera,
    switchCamera,
  };
}

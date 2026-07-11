import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaStream, RTCPeerConnection } from "react-native-webrtc";

import { getWebRtc, isWebRtcAvailable } from "../services/webrtcCompat";
import { fetchIceServers } from "../services/turnCredentials";
import { negotiationActionOnPeerReady, type WatchRoomSignal } from "../utils/watchRoom";

// ---------------------------------------------------------------------------
// Two-person WebRTC face-cam/audio. Because a room is exactly 2 people we use a
// direct peer connection (no SFU): lowest latency, lowest cost. Only the host
// sends the initial offer, so there is no glare/collision to arbitrate. The
// signaling messages (offer/answer/ICE) ride the room's Realtime channel via
// `sendSignal`; the media itself flows phone-to-phone.
//
// Resilience notes (each guards a real failure mode):
//   · webrtc-ready re-announces on an interval until the SDP exchange lands —
//     a single fire-and-forget announce is lost forever if the channel is still
//     joining or mid-flap, wedging both peers in "connecting".
//   · Offers always set iceRestart, so a re-offer re-gathers and re-trickles
//     candidates. Without it, a peer that recreated its connection (camera
//     re-toggle, polaroid handoff) never receives the other side's candidates.
//   · A failed / stuck-disconnected connection triggers a bounded automatic
//     full restart (new connection + fresh TURN creds) — this is what survives
//     a Wi-Fi ↔ cellular switch mid-movie.
//   · Mic/camera mute state survives restarts (kept in refs, reapplied).
//
// The native module is absent in Expo Go — there the hook reports "unavailable"
// and produces no streams, and the UI falls back to placeholder tiles.
// ---------------------------------------------------------------------------

type WebrtcSignal = Extract<
  WatchRoomSignal,
  { type: "webrtc-offer" | "webrtc-answer" | "webrtc-ice" | "webrtc-ready" }
>;

export type PeerConnectionState = "idle" | "unavailable" | "connecting" | "connected" | "failed" | "closed";

export type PeerAudioLevels = { remote: number; local: number };

type Options = {
  // Turn the media layer on only once both participants are in the session.
  enabled: boolean;
  // The host offers; the guest answers.
  isInitiator: boolean;
  selfUserId: string;
  sendSignal: (signal: WatchRoomSignal) => void;
};

// Face tiles render at ~122px — a constrained capture + bitrate cap keeps the
// TURN relay bill and battery drain proportionate to what is actually shown.
const VIDEO_CONSTRAINTS = { facingMode: "user", width: 640, height: 480, frameRate: 24 };
const VIDEO_MAX_BITRATE_BPS = 400_000;

const READY_REANNOUNCE_MS = 2_000;
const READY_LOOP_MAX_TICKS = 45; // ≈90s, then the watchdog / manual retry owns it
const REOFFER_MIN_INTERVAL_MS = 5_000;
const DISCONNECT_GRACE_MS = 8_000;
const RESTART_DELAY_MS = 1_500;
const MAX_AUTO_RESTARTS = 3;

export function useWebRtcPeers({ enabled, isInitiator, selfUserId, sendSignal }: Options) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<PeerConnectionState>(
    isWebRtcAvailable ? "idle" : "unavailable"
  );
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  // Bumping the generation tears the whole media stack down and rebuilds it —
  // the restart primitive used by both the auto-recovery and the retry UI.
  const [generation, setGeneration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteDescSetRef = useRef(false);
  const pendingCandidatesRef = useRef<any[]>([]);
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;
  // The peer has announced a live connection ready to negotiate. Kept in a ref
  // so a host that enables its camera later can still offer once it hears this.
  const peerReadyRef = useRef(false);
  const makingOfferRef = useRef(false);
  const lastOfferAtRef = useRef(0);
  const isInitiatorRef = useRef(isInitiator);
  isInitiatorRef.current = isInitiator;
  const selfUserIdRef = useRef(selfUserId);
  selfUserIdRef.current = selfUserId;
  // Mute state survives restarts / the polaroid camera handoff.
  const micEnabledRef = useRef(true);
  const cameraEnabledRef = useRef(true);

  const restartAttemptsRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const announceReady = useCallback(() => {
    sendSignalRef.current({ type: "webrtc-ready", from: selfUserIdRef.current });
  }, []);

  // Host-only: (re)create and send an offer. Guarded so overlapping readiness
  // signals don't fire concurrent offers, and rate-limited so the re-announce
  // loop doesn't re-gather ICE every tick while an answer is in flight.
  // iceRestart is always set: a re-offer must re-gather + re-trickle candidates
  // or a peer that rebuilt its connection can never complete ICE.
  const makeOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || makingOfferRef.current) return;
    if (Date.now() - lastOfferAtRef.current < REOFFER_MIN_INTERVAL_MS) return;
    makingOfferRef.current = true;
    lastOfferAtRef.current = Date.now();
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      sendSignalRef.current({ type: "webrtc-offer", from: selfUserIdRef.current, sdp: offer.sdp });
    } catch {
      setConnectionState("failed");
    } finally {
      makingOfferRef.current = false;
    }
  }, []);

  // Bounded automatic recovery: rebuild the media stack after a short pause.
  // Attempts reset every time a connection actually succeeds, so a long movie
  // can survive several network switches.
  const scheduleRestart = useCallback(() => {
    if (restartTimerRef.current) return;
    if (restartAttemptsRef.current >= MAX_AUTO_RESTARTS) {
      setConnectionState("failed");
      return;
    }
    restartAttemptsRef.current += 1;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      setGeneration((g) => g + 1);
    }, RESTART_DELAY_MS);
  }, []);

  // Manual retry from the UI: clears the attempt budget and rebuilds now.
  const restartMedia = useCallback(() => {
    restartAttemptsRef.current = 0;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setGeneration((g) => g + 1);
  }, []);

  // Route an incoming webrtc signal from the room channel into the peer.
  const handleSignal = useCallback(
    async (signal: WebrtcSignal) => {
      const webrtc = getWebRtc();

      // Readiness is handled before the peer-connection guard: the host may hear
      // "ready" before its own connection exists, and must remember it.
      if (signal.type === "webrtc-ready") {
        peerReadyRef.current = true;
        const action = negotiationActionOnPeerReady(isInitiatorRef.current);
        if (action === "offer") {
          if (pcRef.current) void makeOffer();
        } else {
          // Guest replies so a host that just enabled learns the guest is ready.
          if (pcRef.current) announceReady();
        }
        return;
      }

      const pc = pcRef.current;
      if (!webrtc || !pc) return;
      try {
        if (signal.type === "webrtc-offer") {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription({ type: "offer", sdp: signal.sdp }));
          remoteDescSetRef.current = true;
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalRef.current({ type: "webrtc-answer", from: selfUserIdRef.current, sdp: answer.sdp });
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
    [flushPendingCandidates, announceReady, makeOffer]
  );

  useEffect(() => {
    if (!enabled) return;
    const webrtc = getWebRtc();
    if (!webrtc) {
      setConnectionState("unavailable");
      return;
    }

    let cancelled = false;
    let readyInterval: ReturnType<typeof setInterval> | null = null;

    async function setup() {
      const { RTCPeerConnection: PC, MediaStream: MS, mediaDevices } = webrtc!;
      setConnectionState("connecting");
      // Fresh negotiation each time media turns on: a re-toggle starts clean.
      remoteDescSetRef.current = false;
      pendingCandidatesRef.current = [];
      makingOfferRef.current = false;
      lastOfferAtRef.current = 0;
      peerReadyRef.current = false;
      const iceServers = await fetchIceServers();
      if (cancelled) return;

      const stream = await mediaDevices
        .getUserMedia({
          // Explicit processing constraints — defaults vary per device and the
          // partner's voice must survive movie audio playing on a speaker.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as any,
          video: VIDEO_CONSTRAINTS,
        })
        .catch(() => null);
      if (cancelled || !stream) {
        // A stream that resolves AFTER teardown began must be stopped here or
        // the camera stays natively locked — expo-camera (the polaroid handoff)
        // and every later getUserMedia would then fail until an app restart.
        stream?.getTracks().forEach((track: any) => track.stop?.());
        if (!cancelled) setConnectionState("failed");
        return;
      }
      // Reapply the user's mute choices from before the restart/handoff.
      stream.getAudioTracks().forEach((track: any) => (track.enabled = micEnabledRef.current));
      stream.getVideoTracks().forEach((track: any) => (track.enabled = cameraEnabledRef.current));
      setMicEnabled(micEnabledRef.current);
      setCameraEnabled(cameraEnabledRef.current);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new PC({ iceServers });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Cap the face-cam bitrate; best-effort (older devices may not support
      // setParameters).
      try {
        for (const sender of (pc as any).getSenders() ?? []) {
          if (sender?.track?.kind !== "video") continue;
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
          params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE_BPS;
          await sender.setParameters(params);
        }
      } catch {
        /* keep default encoder settings */
      }

      (pc as any).onicecandidate = (event: any) => {
        if (event?.candidate) {
          sendSignalRef.current({ type: "webrtc-ice", from: selfUserIdRef.current, candidate: event.candidate });
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
        if (cs === "connected") {
          restartAttemptsRef.current = 0;
          if (disconnectTimerRef.current) {
            clearTimeout(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
          }
          setConnectionState("connected");
          if (__DEV__) void logSelectedCandidatePair(pc);
        } else if (cs === "disconnected") {
          // Give ICE a grace window to self-heal (it often does after a brief
          // radio blip) before forcing a full restart.
          if (!disconnectTimerRef.current) {
            disconnectTimerRef.current = setTimeout(() => {
              disconnectTimerRef.current = null;
              if ((pc as any).connectionState === "disconnected") scheduleRestart();
            }, DISCONNECT_GRACE_MS);
          }
        } else if (cs === "failed") {
          // Show the frozen-partner placeholder instead of a stale last frame.
          setRemoteStream(null);
          setConnectionState("failed");
          scheduleRestart();
        } else if (cs === "closed") {
          setRemoteStream(null);
          setConnectionState("closed");
        }
      };

      // Readiness handshake instead of an immediate offer: announce we're ready,
      // and (host only) offer as soon as we know the guest is ready too. This
      // guarantees the guest's peer connection exists before the offer lands,
      // which a bare "host offers immediately" flow does not. The announce
      // REPEATS until the SDP exchange lands: a single broadcast is lost forever
      // if the room channel is still joining or mid-reconnect.
      announceReady();
      if (isInitiatorRef.current && peerReadyRef.current) {
        await makeOffer();
      }
      let ticks = 0;
      readyInterval = setInterval(() => {
        if (remoteDescSetRef.current || cancelled) {
          if (readyInterval) clearInterval(readyInterval);
          readyInterval = null;
          return;
        }
        ticks += 1;
        if (ticks > READY_LOOP_MAX_TICKS) {
          if (readyInterval) clearInterval(readyInterval);
          readyInterval = null;
          return;
        }
        announceReady();
        // The host also re-offers (rate-limited inside makeOffer) in case its
        // earlier offer was the message that got lost.
        if (isInitiatorRef.current && peerReadyRef.current && pcRef.current) void makeOffer();
      }, READY_REANNOUNCE_MS);
    }

    void setup().catch(() => {
      if (cancelled) return;
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((track: any) => track.stop?.());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setConnectionState("failed");
      scheduleRestart();
    });

    return () => {
      cancelled = true;
      if (readyInterval) clearInterval(readyInterval);
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      // A restart timer that already fired nulled itself before bumping the
      // generation — anything still pending here belongs to a teardown
      // (disable/unmount) and must not resurrect the media stack.
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((track: any) => track.stop?.());
      localStreamRef.current = null;
      remoteDescSetRef.current = false;
      pendingCandidatesRef.current = [];
      makingOfferRef.current = false;
      peerReadyRef.current = false;
      setLocalStream(null);
      setRemoteStream(null);
      setConnectionState(isWebRtcAvailable ? "closed" : "unavailable");
    };
  }, [enabled, isInitiator, selfUserId, generation, announceReady, makeOffer, scheduleRestart]);

  // Clear any pending auto-restart when the media layer is switched off.
  useEffect(() => {
    if (enabled) return;
    restartAttemptsRef.current = 0;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, [enabled]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micEnabledRef.current;
    micEnabledRef.current = next;
    stream.getAudioTracks().forEach((track: any) => (track.enabled = next));
    setMicEnabled(next);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraEnabledRef.current;
    cameraEnabledRef.current = next;
    stream.getVideoTracks().forEach((track: any) => (track.enabled = next));
    setCameraEnabled(next);
  }, []);

  const switchCamera = useCallback(() => {
    const stream = localStreamRef.current;
    stream?.getVideoTracks().forEach((track: any) => track._switchCamera?.());
  }, []);

  // Instantaneous audio levels (0..1) for the ducking controller: the remote
  // partner's voice from inbound-rtp, our own mic from media-source.
  const getAudioLevels = useCallback(async (): Promise<PeerAudioLevels | null> => {
    const pc = pcRef.current;
    if (!pc) return null;
    try {
      const stats: any = await (pc as any).getStats();
      let remote = 0;
      let local = 0;
      stats.forEach((entry: any) => {
        const kind = entry?.kind ?? entry?.mediaType;
        if (kind !== "audio") return;
        if (entry.type === "inbound-rtp") remote = Math.max(remote, entry.audioLevel ?? 0);
        else if (entry.type === "media-source") local = Math.max(local, entry.audioLevel ?? 0);
      });
      return { remote, local };
    } catch {
      return null;
    }
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
    restartMedia,
    getAudioLevels,
  };
}

// Dev-only visibility into which path actually connected (host/srflx/relay) —
// the only way to know from the field whether TURN is doing its job.
async function logSelectedCandidatePair(pc: RTCPeerConnection): Promise<void> {
  try {
    const stats: any = await (pc as any).getStats();
    let pair: any = null;
    const byId: Record<string, any> = {};
    stats.forEach((entry: any) => {
      byId[entry.id] = entry;
      if (entry.type === "candidate-pair" && (entry.selected || entry.nominated) && entry.state === "succeeded") {
        pair = entry;
      }
    });
    if (!pair) return;
    const local = byId[pair.localCandidateId];
    const remote = byId[pair.remoteCandidateId];
    console.log(
      "[WatchTogether] ICE pair:",
      `local=${local?.candidateType ?? "?"}(${local?.protocol ?? "?"})`,
      `remote=${remote?.candidateType ?? "?"}`,
      `rtt=${pair.currentRoundTripTime ?? "?"}`
    );
  } catch {
    /* diagnostics only */
  }
}

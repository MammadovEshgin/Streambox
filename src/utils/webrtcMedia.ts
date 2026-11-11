// Pure helpers behind the Watch Together face-cam (see useWebRtcPeers). Kept
// free of React Native imports so the logic is unit-testable under node.

// ---------------------------------------------------------------------------
// Codec preference
//
// react-native-webrtc's default Android factories list the HARDWARE H.264
// codecs (Constrained High first, High profile forced on) ahead of the
// software VP8/VP9/AV1 ones, and H.264 has no software fallback: when the
// MediaCodec encoder or decoder misbehaves the video simply never renders,
// while audio (Opus, always software) carries on. MediaCodec H.264 quality is
// chipset-specific, which is why only some phones show a black partner tile.
//
// VP8 is libvpx on every phone, cheap at face-cam size, and the codec every
// libwebrtc build is tested against. Putting it first in every description we
// produce AND every description we apply makes it the codec both directions
// send — even when the partner still runs an older bundle that would have
// ordered H.264 first.
// ---------------------------------------------------------------------------

export const PREFERRED_VIDEO_CODEC = "VP8";

/**
 * Reorders the payload types of every `m=<kind>` section so `codecName` (and
 * its RTX retransmission payloads) come first. Everything else keeps its
 * original order; an SDP without the codec is returned unchanged.
 */
export function preferCodecInSdp(sdp: string, codecName: string = PREFERRED_VIDEO_CODEC, kind = "video"): string {
  if (!sdp) return sdp;
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r?\n/);
  const target = codecName.toUpperCase();

  for (let start = 0; start < lines.length; start += 1) {
    if (!lines[start].startsWith(`m=${kind} `)) continue;
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith("m=")) end += 1;
    lines[start] = reorderMediaLine(lines[start], lines.slice(start + 1, end), target);
    start = end - 1;
  }
  return lines.join(eol);
}

function reorderMediaLine(mediaLine: string, sectionLines: string[], target: string): string {
  const parts = mediaLine.split(" ");
  if (parts.length < 4) return mediaLine;
  const payloads = parts.slice(3);

  const codecByPayload = new Map<string, string>();
  const rtxTargetByPayload = new Map<string, string>();
  for (const line of sectionLines) {
    const rtpmap = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(line);
    if (rtpmap) codecByPayload.set(rtpmap[1], rtpmap[2].toUpperCase());
    const fmtp = /^a=fmtp:(\d+) .*?\bapt=(\d+)/.exec(line);
    if (fmtp) rtxTargetByPayload.set(fmtp[1], fmtp[2]);
  }

  const front: string[] = [];
  for (const payload of payloads) {
    if (codecByPayload.get(payload) !== target) continue;
    front.push(payload);
    for (const candidate of payloads) {
      if (codecByPayload.get(candidate) === "RTX" && rtxTargetByPayload.get(candidate) === payload) {
        front.push(candidate);
      }
    }
  }
  if (front.length === 0) return mediaLine;

  const rest = payloads.filter((payload) => !front.includes(payload));
  return [...parts.slice(0, 3), ...front, ...rest].join(" ");
}

// ---------------------------------------------------------------------------
// RTCView binding
//
// The native RTCView resolves the stream's video track ONCE, when its
// `streamURL` changes. A view handed a stream that has no video track yet
// binds to nothing and never looks again — the same URL later carrying video
// is not a prop change. So a tile only mounts once the stream has a live
// video track, and is keyed by that track so a new track remounts the view.
// ---------------------------------------------------------------------------

type TrackLike = { id: string; readyState?: string };
type StreamLike = { toURL(): string; getVideoTracks(): TrackLike[] };

export type RtcViewBinding = { streamURL: string; key: string };

export function rtcViewBinding(stream: StreamLike | null | undefined): RtcViewBinding | null {
  if (!stream) return null;
  try {
    const track = stream.getVideoTracks().find((candidate) => candidate.readyState !== "ended");
    if (!track) return null;
    const streamURL = stream.toURL();
    if (!streamURL) return null;
    return { streamURL, key: `${streamURL}:${track.id}` };
  } catch {
    // Native teardown can invalidate a stream one render before React
    // receives the null state. Render the placeholder instead of throwing.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offer pacing
//
// Re-offering while an earlier offer is still unanswered lets a late answer
// to offer N land on offer N+1, mismatching ICE credentials so the pair never
// connects. Only re-offer once the outstanding offer has had a fair chance.
// ---------------------------------------------------------------------------

export const WEBRTC_REOFFER_MIN_INTERVAL_MS = 5_000;
export const WEBRTC_ANSWER_TIMEOUT_MS = 10_000;

export function canSendOffer(awaitingAnswer: boolean, msSinceLastOffer: number): boolean {
  if (msSinceLastOffer < WEBRTC_REOFFER_MIN_INTERVAL_MS) return false;
  return !awaitingAnswer || msSinceLastOffer >= WEBRTC_ANSWER_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Remote video health
// ---------------------------------------------------------------------------

export type VideoStatsSummary = {
  inboundCodec: string | null;
  framesDecoded: number;
  framesReceived: number;
  bytesReceived: number;
  decoder: string | null;
  outboundCodec: string | null;
  framesEncoded: number;
  encoder: string | null;
};

type StatsReportLike = { forEach(callback: (entry: any) => void): void };

/** Distils a getStats() report down to the video send/receive essentials. */
export function summarizeVideoStats(report: StatsReportLike): VideoStatsSummary {
  const entries: any[] = [];
  report.forEach((entry) => {
    if (entry && typeof entry === "object") entries.push(entry);
  });
  const codecs = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "codec" && typeof entry.mimeType === "string") codecs.set(entry.id, entry.mimeType);
  }
  const isVideo = (entry: any) => (entry.kind ?? entry.mediaType) === "video";
  const inbound = entries.find((entry) => entry.type === "inbound-rtp" && isVideo(entry));
  const outbound = entries.find((entry) => entry.type === "outbound-rtp" && isVideo(entry));
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);

  return {
    inboundCodec: inbound ? codecs.get(inbound.codecId) ?? null : null,
    framesDecoded: count(inbound?.framesDecoded),
    framesReceived: count(inbound?.framesReceived),
    bytesReceived: count(inbound?.bytesReceived),
    decoder: text(inbound?.decoderImplementation),
    outboundCodec: outbound ? codecs.get(outbound.codecId) ?? null : null,
    framesEncoded: count(outbound?.framesEncoded),
    encoder: text(outbound?.encoderImplementation),
  };
}

export type VideoProgress = { framesDecoded: number; changedAtMs: number };

/** Records when the decoded-frame counter last moved. */
export function advanceVideoProgress(
  previous: VideoProgress | null,
  framesDecoded: number,
  nowMs: number
): VideoProgress {
  if (!previous || framesDecoded !== previous.framesDecoded) return { framesDecoded, changedAtMs: nowMs };
  return previous;
}

export function isVideoStalled(progress: VideoProgress, nowMs: number, stallMs: number): boolean {
  return nowMs - progress.changedAtMs >= stallMs;
}

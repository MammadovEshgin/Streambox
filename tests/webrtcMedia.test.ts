import assert from "node:assert/strict";
import test from "node:test";

import {
  WEBRTC_ANSWER_TIMEOUT_MS,
  WEBRTC_REOFFER_MIN_INTERVAL_MS,
  advanceVideoProgress,
  canSendOffer,
  isVideoStalled,
  preferCodecInSdp,
  rtcViewBinding,
  summarizeVideoStats,
} from "../src/utils/webrtcMedia";

// What react-native-webrtc 124 offers on a Snapdragon/Exynos phone: hardware
// H.264 (Constrained High, then Baseline) ahead of the software codecs.
const H264_FIRST_OFFER = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=rtpmap:111 opus/48000/2",
  "a=rtpmap:63 red/48000/2",
  "a=rtpmap:9 G722/8000",
  "a=rtpmap:0 PCMU/8000",
  "a=rtpmap:8 PCMA/8000",
  "m=video 9 UDP/TLS/RTP/SAVPF 100 101 102 103 96 97 98 99 35 36 116 117",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=rtpmap:100 H264/90000",
  "a=fmtp:100 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f",
  "a=rtpmap:101 rtx/90000",
  "a=fmtp:101 apt=100",
  "a=rtpmap:102 H264/90000",
  "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
  "a=rtpmap:103 rtx/90000",
  "a=fmtp:103 apt=102",
  "a=rtpmap:96 VP8/90000",
  "a=rtcp-fb:96 nack pli",
  "a=rtpmap:97 rtx/90000",
  "a=fmtp:97 apt=96",
  "a=rtpmap:98 VP9/90000",
  "a=rtpmap:99 rtx/90000",
  "a=fmtp:99 apt=98",
  "a=rtpmap:35 AV1/90000",
  "a=rtpmap:36 rtx/90000",
  "a=fmtp:36 apt=35",
  "a=rtpmap:116 red/90000",
  "a=rtpmap:117 ulpfec/90000",
  "",
].join("\r\n");

function mediaLine(sdp: string, kind: string): string {
  return sdp.split("\r\n").find((line) => line.startsWith(`m=${kind} `)) ?? "";
}

test("VP8 and its RTX move to the front of the video m-line", () => {
  const munged = preferCodecInSdp(H264_FIRST_OFFER);
  assert.equal(
    mediaLine(munged, "video"),
    "m=video 9 UDP/TLS/RTP/SAVPF 96 97 100 101 102 103 98 99 35 36 116 117"
  );
});

test("only the m-line changes — audio, attributes and CRLF endings are untouched", () => {
  const munged = preferCodecInSdp(H264_FIRST_OFFER);
  assert.equal(mediaLine(munged, "audio"), mediaLine(H264_FIRST_OFFER, "audio"));
  const before = H264_FIRST_OFFER.split("\r\n");
  const after = munged.split("\r\n");
  assert.equal(after.length, before.length);
  const changed = after.filter((line, index) => line !== before[index]);
  assert.deepEqual(changed, [mediaLine(munged, "video")]);
  assert.equal(munged.endsWith("\r\n"), true);
});

test("munging is idempotent, so applying it to both local and remote SDP is safe", () => {
  const once = preferCodecInSdp(H264_FIRST_OFFER);
  assert.equal(preferCodecInSdp(once), once);
});

test("an SDP without VP8 (or empty) is returned as-is", () => {
  const noVp8 = H264_FIRST_OFFER.replace("a=rtpmap:96 VP8/90000", "a=rtpmap:96 VP9/90000");
  assert.equal(preferCodecInSdp(noVp8), noVp8);
  assert.equal(preferCodecInSdp(""), "");
});

test("LF-only SDP keeps LF endings", () => {
  const lf = H264_FIRST_OFFER.replace(/\r\n/g, "\n");
  const munged = preferCodecInSdp(lf);
  assert.equal(munged.includes("\r"), false);
  assert.equal(munged.includes("m=video 9 UDP/TLS/RTP/SAVPF 96 97 100"), true);
});

function fakeStream(url: string, tracks: Array<{ id: string; readyState?: string }>) {
  return { toURL: () => url, getVideoTracks: () => tracks };
}

test("an RTCView binds only once the stream carries a live video track", () => {
  assert.equal(rtcViewBinding(null), null);
  // Audio-only so far: mounting now would bind the native view to nothing.
  assert.equal(rtcViewBinding(fakeStream("tag-1", [])), null);
  assert.equal(rtcViewBinding(fakeStream("tag-1", [{ id: "v1", readyState: "ended" }])), null);
  assert.deepEqual(rtcViewBinding(fakeStream("tag-1", [{ id: "v1", readyState: "live" }])), {
    streamURL: "tag-1",
    key: "tag-1:v1",
  });
});

test("a new video track on the same stream URL changes the RTCView key", () => {
  const first = rtcViewBinding(fakeStream("tag-1", [{ id: "v1" }]));
  const second = rtcViewBinding(fakeStream("tag-1", [{ id: "v2" }]));
  assert.equal(first?.streamURL, second?.streamURL);
  assert.notEqual(first?.key, second?.key);
});

test("a stream invalidated by native teardown renders the placeholder instead of throwing", () => {
  const broken = {
    toURL: () => {
      throw new Error("released");
    },
    getVideoTracks: () => [{ id: "v1" }],
  };
  assert.equal(rtcViewBinding(broken), null);
});

test("offers are paced and never supersede an answer still in flight", () => {
  assert.equal(canSendOffer(false, Number.MAX_SAFE_INTEGER), true);
  assert.equal(canSendOffer(false, WEBRTC_REOFFER_MIN_INTERVAL_MS - 1), false);
  assert.equal(canSendOffer(false, WEBRTC_REOFFER_MIN_INTERVAL_MS), true);
  assert.equal(canSendOffer(true, WEBRTC_REOFFER_MIN_INTERVAL_MS), false);
  // An offer whose answer never came is presumed lost and re-sent.
  assert.equal(canSendOffer(true, WEBRTC_ANSWER_TIMEOUT_MS), true);
});

function report(entries: any[]) {
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  return { forEach: (callback: (entry: any) => void) => map.forEach((entry) => callback(entry)) };
}

test("video stats summary resolves codecs, frame counters and implementations", () => {
  const summary = summarizeVideoStats(
    report([
      { id: "c1", type: "codec", mimeType: "video/VP8" },
      { id: "c2", type: "codec", mimeType: "audio/opus" },
      { id: "in-a", type: "inbound-rtp", kind: "audio", codecId: "c2", bytesReceived: 900 },
      {
        id: "in-v",
        type: "inbound-rtp",
        kind: "video",
        codecId: "c1",
        framesDecoded: 240,
        framesReceived: 241,
        bytesReceived: 512_000,
        decoderImplementation: "libvpx",
      },
      { id: "out-v", type: "outbound-rtp", mediaType: "video", codecId: "c1", framesEncoded: 230, encoderImplementation: "libvpx" },
    ])
  );
  assert.deepEqual(summary, {
    inboundCodec: "video/VP8",
    framesDecoded: 240,
    framesReceived: 241,
    bytesReceived: 512_000,
    decoder: "libvpx",
    outboundCodec: "video/VP8",
    framesEncoded: 230,
    encoder: "libvpx",
  });
});

test("no inbound video entry (no packet ever arrived) reads as zero frames", () => {
  const summary = summarizeVideoStats(report([{ id: "in-a", type: "inbound-rtp", kind: "audio" }]));
  assert.equal(summary.framesDecoded, 0);
  assert.equal(summary.inboundCodec, null);
  assert.equal(summary.decoder, null);
});

test("remote video stalls only after decoded frames stop moving for the full window", () => {
  let progress = advanceVideoProgress(null, 0, 1_000);
  assert.equal(isVideoStalled(progress, 15_999, 15_000), false);
  assert.equal(isVideoStalled(progress, 16_000, 15_000), true);

  // Frames moving keep resetting the clock.
  progress = advanceVideoProgress(null, 0, 0);
  progress = advanceVideoProgress(progress, 24, 3_000);
  progress = advanceVideoProgress(progress, 96, 6_000);
  assert.equal(isVideoStalled(progress, 20_000, 15_000), false);
  // Same count again does not move it.
  progress = advanceVideoProgress(progress, 96, 9_000);
  assert.equal(progress.changedAtMs, 6_000);
  assert.equal(isVideoStalled(progress, 21_000, 15_000), true);
});

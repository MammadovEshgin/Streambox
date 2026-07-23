import assert from "node:assert/strict";
import test from "node:test";

import { negotiationActionOnPeerReady, type WatchRoomSignal } from "../src/utils/watchRoom";

// The readiness handshake (see useWebRtcPeers) exists so the host's SDP offer
// can never race ahead of the guest's peer connection and get dropped. Only the
// host offers, so there is no glare to arbitrate.
test("only the host (initiator) offers when it hears the peer is ready", () => {
  assert.equal(negotiationActionOnPeerReady(true), "offer");
});

test("the guest re-announces readiness so a late-enabling host still learns to offer", () => {
  assert.equal(negotiationActionOnPeerReady(false), "announce-ready");
});

test("webrtc-ready is a valid, minimal signal on the room channel", () => {
  const ready: WatchRoomSignal = { type: "webrtc-ready", from: "user-1" };
  assert.equal(ready.type, "webrtc-ready");
  assert.equal(ready.from, "user-1");
  // No SDP/candidate payload — it is a bare presence-of-connection ping.
  assert.deepEqual(Object.keys(ready).sort(), ["from", "type"]);
});

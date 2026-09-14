import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(rootPath, ...segments), "utf8");
}

test("watch-memory uploads stay native and cancel timed-out responder work", () => {
  const source = readSource("src", "services", "watchMemories.ts");
  assert.equal(source.includes("createSignedUploadUrl"), true);
  assert.equal(source.includes("createUploadTask"), true);
  assert.equal(source.includes("cancelAsync"), true);
  assert.equal(source.indexOf("const deadlineAt") < source.indexOf("createSignedUploadUrl"), true);
  assert.equal(source.includes("remainingMs"), true);
  assert.equal(source.includes("readAsStringAsync"), false);
  assert.equal(source.includes("decode(base64)"), false);
});

test("room transport checks acknowledged sends and runs a liveness probe", () => {
  const source = readSource("src", "services", "watchRoomService.ts");
  assert.equal(source.includes("broadcast: { self: false, ack: true }"), true);
  assert.equal(source.includes('event: "liveness"'), true);
  assert.equal(source.includes('result !== "ok"'), true);
  assert.equal(source.includes("watchRoomReconnectDelayMs"), true);
  assert.equal(source.includes("supabase.realtime.isConnected()"), true);
  assert.equal(source.includes("lifecycleGeneration"), true);
});

test("watch-together overlays stay in-layer and have room-scoped recovery", () => {
  const layerSource = readSource("src", "components", "watchTogether", "WatchRoomLayer.tsx");
  const playerSource = readSource("src", "screens", "PlayerScreen.tsx");
  assert.equal(layerSource.includes("<Modal"), false);
  assert.equal(layerSource.includes("deriveWatchRoomPresenceUiState"), true);
  assert.equal(layerSource.includes("canStartWatchRoomCapture"), true);
  assert.equal(playerSource.includes("<WatchRoomBoundary"), true);
});

// ---------------------------------------------------------------------------
// One-way face-cam: the host saw only their own tile.
//
// `handleSignal` answers an incoming offer as soon as it can see
// `pcRef.current`. The connection used to be published to that ref BEFORE its
// handlers were attached and before an awaited `setParameters` call, so an
// offer landing in that window was answered by a connection with no `ontrack`
// and no `onicecandidate`. The partner's media arrived at a connection that
// was not listening for it and the remote tile stayed empty for the session.
// The width of that window is a native round-trip, which is why it reproduced
// on some phones and not others.
// ---------------------------------------------------------------------------

test("the peer connection is fully wired before it is published or awaited on", () => {
  const source = readSource("src", "hooks", "useWebRtcPeers.ts");

  const construct = source.indexOf("const pc = new PC({ iceServers });");
  const onTrack = source.indexOf("(pc as any).ontrack =");
  const onIce = source.indexOf("(pc as any).onicecandidate =");
  const onState = source.indexOf("(pc as any).onconnectionstatechange =");
  const addTrack = source.indexOf("stream.getTracks().forEach((track) => pc.addTrack(track, stream));");
  const publish = source.indexOf("pcRef.current = pc;");
  const setParameters = source.indexOf("await sender.setParameters(params);");

  for (const [name, index] of Object.entries({ construct, onTrack, onIce, onState, addTrack, publish, setParameters })) {
    assert.notEqual(index, -1, `${name} should be present`);
  }

  assert.ok(onIce > construct && onTrack > construct && onState > construct, "handlers attach after construction");
  assert.ok(onTrack < publish, "ontrack must be attached before the connection is published");
  assert.ok(onIce < publish, "onicecandidate must be attached before the connection is published");
  assert.ok(onState < publish, "onconnectionstatechange must be attached before publishing");
  assert.ok(
    addTrack < publish,
    "local tracks must be added before publishing, or an answer is created send-less"
  );
  assert.ok(
    setParameters > publish,
    "the awaited setParameters call must not sit between construction and publishing"
  );

  // Nothing may await between constructing the connection and publishing it.
  // Strip comments first — the explanation there says the word "await".
  const wiringWindow = source
    .slice(construct, publish)
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(wiringWindow.includes("await "), false, "no await may widen the wiring window");
});

test("an offer that arrives before the connection exists is replayed, not dropped", () => {
  // The guest's getUserMedia sits on the camera permission dialog, so the
  // host's offer routinely lands first. Dropping it cost a full re-announce
  // round-trip, or the whole session once the host's announce loop expired.
  const source = readSource("src", "hooks", "useWebRtcPeers.ts");
  assert.equal(source.includes("pendingOfferRef"), true);
  assert.equal(source.includes("const drainPendingOffer = useCallback("), true);
  assert.equal(source.includes("await drainPendingOffer();"), true);
  assert.equal(
    source.includes('if (signal.type === "webrtc-offer") pendingOfferRef.current = signal;'),
    true
  );

  // Stale offers must not survive a teardown or a restart generation.
  assert.equal(source.split("pendingOfferRef.current = null;").length - 1 >= 3, true);
});

test("a peer still coming up answers the readiness handshake", () => {
  // Staying silent until our own connection existed let the host's announce
  // loop expire against a guest that was merely slow to open its camera.
  const source = readSource("src", "hooks", "useWebRtcPeers.ts");
  // `const pc = pcRef.current;` also appears in flushPendingCandidates above,
  // so search for the one that follows the ready branch.
  const readyStart = source.indexOf('if (signal.type === "webrtc-ready")');
  const readyBranch = source.slice(readyStart, source.indexOf("const pc = pcRef.current;", readyStart));
  assert.ok(readyBranch.length > 0, "ready branch should be locatable");
  assert.equal(readyBranch.includes("if (pcRef.current) announceReady();"), false);
  assert.equal(readyBranch.includes("announceReady();"), true);
});

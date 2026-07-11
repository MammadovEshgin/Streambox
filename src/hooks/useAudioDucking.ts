import { useEffect, useRef } from "react";
import type { VideoPlayer } from "expo-video";

import {
  DUCK_RAMP_MS,
  DUCK_VOLUME_FACTOR,
  DuckingController,
  RESTORE_RAMP_MS,
} from "../utils/audioDucking";
import type { PeerAudioLevels } from "./useWebRtcPeers";

// Ducks the movie while someone is talking on the face-cam call. Voice
// activity comes from WebRTC's own stats (remote inbound-rtp audioLevel = the
// partner's voice, media-source = our mic); the decision logic lives in the
// pure DuckingController. Polls only while a call is actually connected.

const POLL_INTERVAL_MS = 200;
// Our own mic is the riskier trigger (it hears the movie too, pre-NS), so it
// weighs in below the partner's decoded voice level.
const LOCAL_LEVEL_WEIGHT = 0.75;

type Options = {
  player: VideoPlayer | null;
  getAudioLevels: () => Promise<PeerAudioLevels | null>;
  active: boolean;
};

export function useAudioDucking({ player, getAudioLevels, active }: Options) {
  const playerRef = useRef(player);
  playerRef.current = player;
  const getLevelsRef = useRef(getAudioLevels);
  getLevelsRef.current = getAudioLevels;

  useEffect(() => {
    if (!active || !player) return;

    const controller = new DuckingController();
    let disposed = false;
    let preDuckVolume: number | null = null;
    let rampTimer: ReturnType<typeof setInterval> | null = null;

    const readVolume = (p: VideoPlayer): number => {
      try {
        return typeof p.volume === "number" ? p.volume : 1;
      } catch {
        return 1;
      }
    };

    // Small stepped ramp — an instant volume cut reads as a glitch; a short
    // fade reads as intentional.
    const rampVolumeTo = (target: number, durationMs: number) => {
      if (rampTimer) {
        clearInterval(rampTimer);
        rampTimer = null;
      }
      const p = playerRef.current;
      if (!p) return;
      const start = readVolume(p);
      const steps = Math.max(1, Math.round(durationMs / 40));
      let step = 0;
      rampTimer = setInterval(() => {
        step += 1;
        try {
          (playerRef.current ?? p).volume = start + (target - start) * (step / steps);
        } catch {
          /* player released mid-ramp */
        }
        if (step >= steps && rampTimer) {
          clearInterval(rampTimer);
          rampTimer = null;
        }
      }, 40);
    };

    const poll = setInterval(() => {
      void (async () => {
        try {
          const levels = await getLevelsRef.current();
          if (disposed || !levels) return;
          const level = Math.max(levels.remote, levels.local * LOCAL_LEVEL_WEIGHT);
          const action = controller.sample(level, Date.now());
          const p = playerRef.current;
          if (!p) return;
          if (action === "duck") {
            preDuckVolume = readVolume(p);
            rampVolumeTo(preDuckVolume * DUCK_VOLUME_FACTOR, DUCK_RAMP_MS);
          } else if (action === "restore") {
            rampVolumeTo(preDuckVolume ?? 1, RESTORE_RAMP_MS);
            preDuckVolume = null;
          }
        } catch {
          /* peer/player released while an async poll was in flight */
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(poll);
      if (rampTimer) clearInterval(rampTimer);
      // Never leave the movie stuck quiet when the call ends mid-sentence.
      const p = playerRef.current;
      if (p && preDuckVolume != null) {
        try {
          p.volume = preDuckVolume;
        } catch {
          /* player released */
        }
      }
    };
  }, [active, player]);
}

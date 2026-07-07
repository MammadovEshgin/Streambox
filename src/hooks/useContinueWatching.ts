import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { VideoPlayer } from "expo-video";

import type { MediaType } from "../api/tmdb";
import { CONTINUE_WATCHING_STORAGE_KEY } from "../services/userDataStorage";
import {
  CONTINUE_WATCHING_SAVE_INTERVAL_MS,
  accumulateWatchedDelta,
  applyPlaybackSnapshot,
  clearFinishedTarget,
  findResumeEntry,
  getResumePositionSeconds,
  parseContinueWatchingState,
  type ContinueWatchingState,
} from "../utils/continueWatching";

type UseContinueWatchingParams = {
  player: VideoPlayer;
  /** True only while the resolved source plays in the native expo-video player. */
  enabled: boolean;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  seasonNumber?: number;
  episodeNumber?: number;
};

// "none" — no saved position for this title, playback starts normally.
// "awaiting" — the resume prompt is on screen; hold play() until answered.
type ResumeChoice = "none" | "awaiting" | "resume" | "startOver";

/**
 * Continue-watching for the native player. Tracks real watched time via the
 * player's timeUpdate ticks, persists the position throttled (plus on pause,
 * on background and on unmount), and drives the resume-or-start-over prompt
 * shown when the user re-opens a title they left mid-way.
 */
export function useContinueWatching({
  player,
  enabled,
  mediaType,
  tmdbId,
  title,
  seasonNumber,
  episodeNumber,
}: UseContinueWatchingParams) {
  // Saved position to show in the prompt; non-null means the modal is open.
  const [promptPositionSeconds, setPromptPositionSeconds] = useState<number | null>(null);

  const playerRef = useRef(player);
  playerRef.current = player;
  const targetRef = useRef({ mediaType, tmdbId, seasonNumber, episodeNumber });
  targetRef.current = { mediaType, tmdbId, seasonNumber, episodeNumber };
  const titleRef = useRef(title);
  titleRef.current = title;
  const enabledRef = useRef(enabled);

  const stateRef = useRef<ContinueWatchingState | null>(null);
  const choiceRef = useRef<ResumeChoice>("none");
  const promptShownRef = useRef(false);
  const resumePositionRef = useRef<number | null>(null);
  const playbackReadyRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const finishedRef = useRef(false);

  const lastPositionRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const watchedSecondsRef = useRef(0);
  const lastSaveAtRef = useRef(0);

  const persistState = useCallback((next: ContinueWatchingState) => {
    stateRef.current = next;
    void AsyncStorage.setItem(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const flush = useCallback(() => {
    const state = stateRef.current;
    if (!state || !enabledRef.current || finishedRef.current) return;
    const position = lastPositionRef.current;
    if (position === null) return;

    const { state: next, changed } = applyPlaybackSnapshot(state, {
      ...targetRef.current,
      title: titleRef.current,
      positionSeconds: position,
      durationSeconds: durationRef.current,
      watchedSeconds: watchedSecondsRef.current,
    });
    if (!changed) return;
    lastSaveAtRef.current = Date.now();
    persistState(next);
  }, [persistState]);

  const maybeShowPrompt = useCallback(() => {
    if (promptShownRef.current || playbackStartedRef.current) return;
    if (!enabledRef.current || !stateRef.current) return;
    const entry = findResumeEntry(stateRef.current, targetRef.current);
    if (!entry) return;
    promptShownRef.current = true;
    choiceRef.current = "awaiting";
    resumePositionRef.current = getResumePositionSeconds(entry);
    setPromptPositionSeconds(entry.positionSeconds);
  }, []);

  // Load the saved state once per player session.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CONTINUE_WATCHING_STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        stateRef.current = parseContinueWatchingState(raw);
        maybeShowPrompt();
      })
      .catch(() => {
        if (!cancelled) stateRef.current = parseContinueWatchingState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [maybeShowPrompt]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) {
      maybeShowPrompt();
    } else if (choiceRef.current === "awaiting") {
      // The source fell back to a non-native path — withdraw the prompt.
      choiceRef.current = "none";
      setPromptPositionSeconds(null);
    }
  }, [enabled, maybeShowPrompt]);

  const beginPlayback = useCallback((seekToSeconds: number | null) => {
    playbackStartedRef.current = true;
    const currentPlayer = playerRef.current;
    try {
      if (seekToSeconds !== null && seekToSeconds > 0) {
        let position = seekToSeconds;
        const duration = currentPlayer.duration;
        if (Number.isFinite(duration) && duration > 0) {
          position = Math.min(position, Math.max(0, duration - 5));
        }
        currentPlayer.currentTime = position;
      }
      currentPlayer.play();
    } catch {
      /* expo-video already torn down */
    }
  }, []);

  /**
   * Called from the player's readyToPlay handler. Returns true when the hook
   * owns starting playback (prompt still open, or a resume seek is applied);
   * the caller must then skip its own play().
   */
  const handlePlaybackReady = useCallback((): boolean => {
    playbackReadyRef.current = true;
    switch (choiceRef.current) {
      case "awaiting":
        return true;
      case "resume":
        beginPlayback(resumePositionRef.current);
        return true;
      default:
        playbackStartedRef.current = true;
        return false;
    }
  }, [beginPlayback]);

  const chooseResume = useCallback(() => {
    choiceRef.current = "resume";
    setPromptPositionSeconds(null);
    if (playbackReadyRef.current) beginPlayback(resumePositionRef.current);
  }, [beginPlayback]);

  const chooseStartOver = useCallback(() => {
    choiceRef.current = "startOver";
    setPromptPositionSeconds(null);
    if (playbackReadyRef.current) beginPlayback(null);
  }, [beginPlayback]);

  // Playback tracking + persistence triggers.
  useEffect(() => {
    if (!enabled) return;

    try {
      player.timeUpdateEventInterval = 1;
    } catch {
      /* expo-video already torn down */
    }

    const timeSub = player.addListener("timeUpdate", (ev: any) => {
      const position = typeof ev?.currentTime === "number" ? ev.currentTime : NaN;
      if (!Number.isFinite(position) || position < 0) return;
      watchedSecondsRef.current += accumulateWatchedDelta(lastPositionRef.current, position);
      lastPositionRef.current = position;
      try {
        const duration = player.duration;
        if (Number.isFinite(duration) && duration > 0) durationRef.current = duration;
      } catch {
        /* expo-video already torn down */
      }
      if (Date.now() - lastSaveAtRef.current >= CONTINUE_WATCHING_SAVE_INTERVAL_MS) flush();
    });

    const endSub = player.addListener("playToEnd", () => {
      finishedRef.current = true;
      const state = stateRef.current;
      if (!state) return;
      const { state: next, changed } = clearFinishedTarget(state, targetRef.current);
      if (changed) persistState(next);
    });

    // Persist promptly on pause so a kill right after still has the position.
    const playingSub = player.addListener("playingChange", (ev: any) => {
      if (ev?.isPlaying === false) flush();
    });

    const appStateSub = AppState.addEventListener("change", (status) => {
      if (status === "background" || status === "inactive") flush();
    });

    return () => {
      timeSub.remove();
      endSub.remove();
      playingSub.remove();
      appStateSub.remove();
      flush();
    };
  }, [player, enabled, flush, persistState]);

  return {
    promptPositionSeconds,
    chooseResume,
    chooseStartOver,
    handlePlaybackReady,
  };
}

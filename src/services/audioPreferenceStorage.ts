import AsyncStorage from "@react-native-async-storage/async-storage";

import { DEFAULT_AUDIO_PREFERENCE, type AudioPreference } from "../utils/audioTracks";

/**
 * Remembers which soundtrack the viewer picked on a dual-audio stream so the
 * choice carries to the next title instead of resetting to the provider's
 * Turkish-dub default on every play.
 *
 * Deliberately a standalone key rather than part of PersistedSettings: it is
 * player-local, changes from inside the player overlay, and must not drag the
 * settings-sync queue along for a menu tap.
 */
const STORAGE_KEY = "@streambox/audio-preference-v1";

export async function loadAudioPreference(): Promise<AudioPreference> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIO_PREFERENCE;

    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const candidate = parsed as { kind?: unknown; language?: unknown };
      if (candidate.kind === "original") return { kind: "original" };
      if (candidate.kind === "language" && typeof candidate.language === "string" && candidate.language) {
        return { kind: "language", language: candidate.language };
      }
    }
  } catch {
    /* unreadable preference — fall through to the default */
  }

  return DEFAULT_AUDIO_PREFERENCE;
}

export async function saveAudioPreference(preference: AudioPreference): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* non-critical: the preference just won't persist past this session */
  }
}

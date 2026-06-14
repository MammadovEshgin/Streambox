import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Subscribes to the OS "Reduce Motion" accessibility preference.
 *
 * Returns `true` if motion should be minimised — components should skip or
 * shorten non-essential animations (parallax, large scale/translate, spring
 * bounces, gratuitous fades). Functional motion (focus indicators, state
 * transitions essential to comprehension) should remain.
 *
 * Reads once at mount and stays in sync with system changes via the
 * `reduceMotionChanged` event. Failures fall back to `false` (motion enabled),
 * which preserves the existing animated UX rather than silently disabling it.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        // Some platforms (older Android) may not implement the API; fall back to motion enabled.
      });

    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setReduceMotion(enabled);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}

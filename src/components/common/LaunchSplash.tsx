import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import styled from "styled-components/native";

import { MovieLoader } from "./MovieLoader";

// Tight-cropped wallet mark (the adaptive-icon foreground has ~30% transparent
// safe-zone padding baked in, which otherwise reads as a big gap to the
// wordmark). streambox-logo.png is that mark with the padding removed.
const MARK = require("../../../assets/app-icons/streambox-logo.png");

const LOGO_H = 66;
const LOGO_ASPECT = 374 / 514; // cropped mark dimensions (taller than wide)
const LOGO_W = Math.round(LOGO_H * LOGO_ASPECT);
const GAP = 10;
// How far the wordmark travels in from the right before settling.
const WORD_FROM_RIGHT = 56;

// ── Timeline (ms) ───────────────────────────────────────────────────────────
// Deliberately slow (~4.5s total) so the reveal reads as premium, not rushed.
const APPEAR_MS = 700;       // logo fades in at center
const BEAT_GROW = 750;       // heartbeat: scale up (once)
const BEAT_SHRINK = 850;     // heartbeat: scale back
const SETTLE_PAUSE = 450;    // pause before the slide
const MOVE_MS = 1150;        // spin-left + wordmark-from-right
const HOLD_MS = 650;         // hold the formed lockup before handing off

const PULSE_END = APPEAR_MS + BEAT_GROW + BEAT_SHRINK;
const MOVE_START = PULSE_END + SETTLE_PAUSE;
/**
 * When the last moving beat (the spin-slide) lands. From here the lockup is
 * static, so heavy work — mounting the app beneath — can no longer make the
 * animation stutter.
 */
export const LAUNCH_SPLASH_MOTION_END_MS = MOVE_START + MOVE_MS;
/** Total time from mount to the moment the lockup is fully settled. */
export const LAUNCH_SPLASH_DURATION_MS = LAUNCH_SPLASH_MOTION_END_MS + HOLD_MS;
// After the hold, the whole splash fades out to reveal the content already
// painted beneath it (the splash is an opaque absolute overlay — see App.tsx).
const FADE_OUT_MS = 260;
// How long the settled lockup may wait for the content beneath to paint before
// it fades regardless (the loading fallback takes over from there).
const MAX_REVEAL_WAIT_MS = 1500;

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

// The launch splash covers the app as a top-most opaque layer so content can
// mount and paint underneath while the reveal plays. Unmounting used to swap
// the splash for a not-yet-painted navigation tree, which flashed the black
// window background for a frame or two.
const OverlayRoot = styled(Animated.View)`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const Lockup = styled.View`
  flex-direction: row;
  align-items: center;
`;

const LogoImage = styled(Animated.Image)`
  width: ${LOGO_W}px;
  height: ${LOGO_H}px;
`;

const Wordmark = styled(Animated.Text)`
  margin-left: ${GAP}px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 30px;
  line-height: 34px;
  letter-spacing: -0.4px;
`;

type LaunchSplashProps = {
  /** Fires once the splash has faded out. */
  onComplete?: () => void;
  /**
   * Whether the content beneath has painted. The settled lockup holds until it
   * has (at most MAX_REVEAL_WAIT_MS), so the fade reveals a finished screen.
   */
  canReveal?: boolean;
};

export function LaunchSplash({ onComplete, canReveal = true }: LaunchSplashProps) {
  const enter = useSharedValue(0);
  const scale = useSharedValue(1);
  const move = useSharedValue(0);
  const fade = useSharedValue(1);
  // Measured wordmark width so the logo can rest at the true screen center
  // (the lockup reserves logo + gap + word; the logo sits left of that center
  // by half the gap+word, so we offset it right by that amount until it slides).
  const wordWidth = useSharedValue(150);
  const [lockupSettled, setLockupSettled] = useState(false);
  const [revealWaitExpired, setRevealWaitExpired] = useState(false);

  useEffect(() => {
    enter.value = withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) });

    // Smooth single heartbeat: a slow eased pop up, then an eased settle back.
    const grow = withTiming(2, { duration: BEAT_GROW, easing: Easing.inOut(Easing.cubic) });
    const shrink = withTiming(1, { duration: BEAT_SHRINK, easing: Easing.inOut(Easing.cubic) });
    scale.value = withDelay(APPEAR_MS, withSequence(grow, shrink));

    move.value = withDelay(MOVE_START, withTiming(1, { duration: MOVE_MS, easing: Easing.out(Easing.cubic) }));

    const settledTimer = setTimeout(() => setLockupSettled(true), LAUNCH_SPLASH_DURATION_MS);
    const revealWaitTimer = setTimeout(() => setRevealWaitExpired(true), LAUNCH_SPLASH_DURATION_MS + MAX_REVEAL_WAIT_MS);
    return () => {
      clearTimeout(settledTimer);
      clearTimeout(revealWaitTimer);
    };
  }, [enter, scale, move]);

  const shouldFade = lockupSettled && (canReveal || revealWaitExpired);

  // Reveal ends → fade the overlay away over the content beneath, and only
  // then unmount (onComplete).
  useEffect(() => {
    if (!shouldFade) return;
    fade.value = withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad) });
    const doneTimer = setTimeout(() => onComplete?.(), FADE_OUT_MS);
    return () => clearTimeout(doneTimer);
  }, [shouldFade, fade, onComplete]);

  const onWordLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) wordWidth.value = width;
  };

  const logoStyle = useAnimatedStyle(() => {
    "worklet";
    const home = (GAP + wordWidth.value) / 2; // rightward offset that centers the logo
    return {
      opacity: enter.value,
      transform: [
        { translateX: interpolate(move.value, [0, 1], [home, 0]) },
        { scale: scale.value },
        { rotate: `${interpolate(move.value, [0, 1], [0, -360])}deg` },
      ],
    };
  });

  const wordStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: interpolate(move.value, [0, 0.3, 1], [0, 0, 1]),
      transform: [{ translateX: interpolate(move.value, [0, 1], [WORD_FROM_RIGHT, 0]) }],
    };
  });

  const overlayStyle = useAnimatedStyle(() => {
    "worklet";
    return { opacity: fade.value };
  });

  return (
    <OverlayRoot style={overlayStyle}>
      <Lockup>
        <LogoImage source={MARK} resizeMode="contain" style={logoStyle} />
        <Wordmark onLayout={onWordLayout} style={wordStyle}>
          StreamBox
        </Wordmark>
      </Lockup>
    </OverlayRoot>
  );
}

// ── Loading fallback ─────────────────────────────────────────────────────────
// Shown only if content still isn't ready after the splash finishes. Same dark
// canvas so the handoff from the splash is seamless.
export function SplashLoading() {
  const { t } = useTranslation();

  return (
    <Root>
      <MovieLoader size={40} label={t("loaders.loading")} />
    </Root>
  );
}

/**
 * The same canvas without the spinner, for underneath the splash: nothing
 * there is visible, but a spinning loader still costs a redraw every frame on
 * the UI thread the splash animation needs.
 */
export function SplashBackdrop() {
  return <Root />;
}

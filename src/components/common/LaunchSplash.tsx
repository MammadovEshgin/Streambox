import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import styled from "styled-components/native";

const MARK = require("../../../assets/app-icons/adaptive-foreground.png");

const LOGO = 72;
const GAP = 14;
// How far the wordmark travels in from the right before settling.
const WORD_FROM_RIGHT = 56;

// ── Timeline (ms) ───────────────────────────────────────────────────────────
const APPEAR_MS = 220;       // logo fades in at center
const BEAT_GROW = 200;       // heartbeat: scale up
const BEAT_SHRINK = 250;     // heartbeat: scale back
const BEAT_COUNT = 3;        // heartbeat ×3
const SETTLE_PAUSE = 150;    // pause before the slide
const MOVE_MS = 700;         // spin-left + wordmark-from-right
const HOLD_MS = 240;         // hold the formed lockup before handing off

const BEAT_MS = BEAT_GROW + BEAT_SHRINK;
const PULSE_END = APPEAR_MS + BEAT_MS * BEAT_COUNT;
const MOVE_START = PULSE_END + SETTLE_PAUSE;
/** Total time from mount to the moment the lockup is fully settled. */
export const LAUNCH_SPLASH_DURATION_MS = MOVE_START + MOVE_MS + HOLD_MS;

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const Lockup = styled.View`
  flex-direction: row;
  align-items: center;
`;

const LogoImage = styled(Animated.Image)`
  width: ${LOGO}px;
  height: ${LOGO}px;
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
  /** Fires once the full reveal has finished (logo settled into the lockup). */
  onComplete?: () => void;
};

export function LaunchSplash({ onComplete }: LaunchSplashProps) {
  const enter = useSharedValue(0);
  const scale = useSharedValue(1);
  const move = useSharedValue(0);
  // Measured wordmark width so the logo can rest at the true screen center
  // (the lockup reserves logo + gap + word; the logo sits left of that center
  // by half the gap+word, so we offset it right by that amount until it slides).
  const wordWidth = useSharedValue(150);

  useEffect(() => {
    enter.value = withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) });

    // Smooth heartbeat: a soft pop up, an eased settle back — repeated.
    const grow = withTiming(2, { duration: BEAT_GROW, easing: Easing.out(Easing.quad) });
    const shrink = withTiming(1, { duration: BEAT_SHRINK, easing: Easing.inOut(Easing.quad) });
    scale.value = withDelay(
      APPEAR_MS,
      withSequence(grow, shrink, grow, shrink, grow, shrink)
    );

    move.value = withDelay(MOVE_START, withTiming(1, { duration: MOVE_MS, easing: Easing.out(Easing.cubic) }));

    const doneTimer = setTimeout(() => onComplete?.(), LAUNCH_SPLASH_DURATION_MS);
    return () => clearTimeout(doneTimer);
  }, [enter, scale, move, onComplete]);

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

  return (
    <Root>
      <Lockup>
        <LogoImage source={MARK} resizeMode="contain" style={logoStyle} />
        <Wordmark onLayout={onWordLayout} style={wordStyle}>
          StreamBox
        </Wordmark>
      </Lockup>
    </Root>
  );
}

// ── Loading fallback ─────────────────────────────────────────────────────────
// Shown only if content still isn't ready after the splash finishes. Same dark
// canvas so the handoff from the splash is seamless.
const SpinnerRing = styled(Animated.View)`
  width: 38px;
  height: 38px;
  border-radius: 19px;
  border-width: 2.5px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  border-top-color: ${({ theme }) => theme.colors.primary};
`;

const LoadingText = styled.Text`
  margin-top: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
`;

export function SplashLoading() {
  const { t } = useTranslation();
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.linear }), -1, false);
  }, [spin]);

  const spinStyle = useAnimatedStyle(() => {
    "worklet";
    return { transform: [{ rotate: `${spin.value * 360}deg` }] };
  });

  return (
    <Root>
      <SpinnerRing style={spinStyle} />
      <LoadingText>{t("loaders.loading")}</LoadingText>
    </Root>
  );
}

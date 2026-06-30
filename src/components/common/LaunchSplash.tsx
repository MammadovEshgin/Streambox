import { useEffect } from "react";
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
  type SharedValue,
} from "react-native-reanimated";
import styled from "styled-components/native";

const MARK = require("../../../assets/app-icons/adaptive-foreground.png");

const LOGO = 72;
const GAP = 14;
// How far the wordmark travels in from the right before settling.
const WORD_FROM_RIGHT = 56;

const EASE_OUT = Easing.out(Easing.cubic);
const EASE_IN_OUT = Easing.inOut(Easing.quad);

// ── Timeline (ms) ───────────────────────────────────────────────────────────
const APPEAR_MS = 300;       // logo fades in at center
const PULSE_HALF = 220;      // grow, then shrink — one half each
const PULSE_COUNT = 3;       // heartbeat ×3
const SETTLE_PAUSE = 140;    // beat before the slide
const MOVE_MS = 720;         // spin-left + wordmark-from-right

const PULSE_END = APPEAR_MS + PULSE_HALF * 2 * PULSE_COUNT;
const MOVE_START = PULSE_END + SETTLE_PAUSE;

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

const Dots = styled(Animated.View)`
  position: absolute;
  bottom: 12%;
  flex-direction: row;
`;

const Dot = styled(Animated.View)<{ $color: string }>`
  width: 6px;
  height: 6px;
  border-radius: 3px;
  margin: 0 4px;
  background-color: ${({ $color }) => $color};
`;

function LoadingDot({ index, loop, color }: { index: number; loop: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    "worklet";
    // A soft highlight travels across the three dots.
    const phase = (loop.value - index / 3 + 1) % 1;
    const lift = Math.max(0, 1 - Math.abs(phase - 0.5) * 3);
    return { opacity: 0.32 + lift * 0.6, transform: [{ scale: 0.9 + lift * 0.25 }] };
  });
  return <Dot $color={color} style={style} />;
}

export function LaunchSplash() {
  const enter = useSharedValue(0);
  const scale = useSharedValue(1);
  const move = useSharedValue(0);
  const dotsFade = useSharedValue(0);
  const dotsLoop = useSharedValue(0);
  // Measured wordmark width so the logo can rest at the true screen center
  // (the lockup reserves logo + gap + word; the logo sits left of that center
  // by half the gap+word, so we offset it right by that amount until it slides).
  const wordWidth = useSharedValue(150);

  useEffect(() => {
    enter.value = withTiming(1, { duration: APPEAR_MS, easing: EASE_OUT });

    const grow = withTiming(2, { duration: PULSE_HALF, easing: EASE_OUT });
    const shrink = withTiming(1, { duration: PULSE_HALF, easing: EASE_IN_OUT });
    scale.value = withDelay(
      APPEAR_MS,
      withSequence(grow, shrink, grow, shrink, grow, shrink)
    );

    move.value = withDelay(MOVE_START, withTiming(1, { duration: MOVE_MS, easing: EASE_OUT }));

    dotsFade.value = withDelay(MOVE_START + MOVE_MS - 120, withTiming(1, { duration: 360, easing: EASE_OUT }));
    dotsLoop.value = withDelay(
      MOVE_START + MOVE_MS,
      withRepeat(withTiming(1, { duration: 1300, easing: Easing.linear }), -1, false)
    );
  }, [enter, scale, move, dotsFade, dotsLoop]);

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
      opacity: interpolate(move.value, [0, 0.25, 1], [0, 0, 1]),
      transform: [{ translateX: interpolate(move.value, [0, 1], [WORD_FROM_RIGHT, 0]) }],
    };
  });

  const dotsStyle = useAnimatedStyle(() => {
    "worklet";
    return { opacity: dotsFade.value };
  });

  return (
    <Root>
      <Lockup>
        <LogoImage source={MARK} resizeMode="contain" style={logoStyle} />
        <Wordmark onLayout={onWordLayout} style={wordStyle}>
          StreamBox
        </Wordmark>
      </Lockup>

      <Dots style={dotsStyle} pointerEvents="none">
        <LoadingDotRow loop={dotsLoop} />
      </Dots>
    </Root>
  );
}

function LoadingDotRow({ loop }: { loop: SharedValue<number> }) {
  const color = "rgba(255,255,255,0.55)";
  return (
    <>
      <LoadingDot index={0} loop={loop} color={color} />
      <LoadingDot index={1} loop={loop} color={color} />
      <LoadingDot index={2} loop={loop} color={color} />
    </>
  );
}

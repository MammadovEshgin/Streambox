import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { withAlpha } from "../../theme/Theme";

const WORDMARK = "STREAMBOX";
const MARK = require("../../../assets/app-icons/adaptive-foreground.png");

// Normalised stagger window for the per-letter rise. progress runs 0 -> 1; each
// letter lights `LETTER_SPAN` after its `index * STAGGER` offset.
const STAGGER = 0.055;
const LETTER_SPAN = 0.42;

const EASE_OUT = Easing.out(Easing.cubic);

type LaunchSplashProps = {
  /** "launch" = first cold boot, "sync" = returning user hydrating data. */
  variant?: "launch" | "sync";
};

const Root = styled(Animated.View)`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const BackdropGradient = styled(LinearGradient)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const Center = styled.View`
  align-items: center;
  justify-content: center;
`;

// Soft accent halo behind the mark. Layered translucent rings fake a blur
// without paying for a live blur view during cold start.
const Glow = styled(Animated.View)<{ $size: number; $color: string }>`
  position: absolute;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  background-color: ${({ $color }) => $color};
`;

const Lockup = styled.View`
  align-items: center;
  overflow: hidden;
  padding: 6px 10px;
`;

const MarkRing = styled(Animated.View)<{ $color: string }>`
  width: 84px;
  height: 84px;
  border-radius: 26px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ $color }) => $color};
`;

const MarkImage = styled.Image`
  width: 54px;
  height: 54px;
`;

const WordRow = styled.View`
  flex-direction: row;
  margin-top: 20px;
`;

const Letter = styled(Animated.Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 29px;
  line-height: 34px;
  letter-spacing: 1px;
`;

// The travelling sheen: a narrow diagonal highlight clipped to the lockup.
const Sheen = styled(Animated.View)<{ $h: number }>`
  position: absolute;
  top: ${({ $h }) => -$h * 0.5}px;
  width: 78px;
  height: ${({ $h }) => $h * 2}px;
`;

const SheenFill = styled(LinearGradient)`
  flex: 1;
`;

const Caption = styled(Animated.Text)`
  margin-top: 30px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: 0.4px;
  text-align: center;
`;

const ProgressTrack = styled.View`
  margin-top: 18px;
  width: 132px;
  height: 2.5px;
  border-radius: 2px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.glassBorder};
`;

const ProgressChunk = styled(Animated.View)`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 56px;
`;

const ProgressFill = styled(LinearGradient)`
  flex: 1;
  border-radius: 2px;
`;

function WordLetter({
  char,
  index,
  progress,
}: {
  char: string;
  index: number;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    "worklet";
    const start = index * STAGGER;
    const raw = (progress.value - start) / LETTER_SPAN;
    const local = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const eased = 1 - Math.pow(1 - local, 3);
    return {
      opacity: eased,
      transform: [{ translateY: (1 - eased) * 18 }],
    };
  });

  return <Letter style={style}>{char}</Letter>;
}

export function LaunchSplash({ variant = "launch" }: LaunchSplashProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();

  const phrases = useMemo(() => {
    const key = variant === "sync" ? "loaders.syncPhrases" : "loaders.launchPhrases";
    const value = t(key, { returnObjects: true }) as unknown;
    return Array.isArray(value) && value.length > 0
      ? (value as string[])
      : [t("loaders.preparingCinemaRoom")];
  }, [t, variant]);

  const [phraseIndex, setPhraseIndex] = useState(0);
  const [lockup, setLockup] = useState({ width: windowWidth * 0.6, height: 150 });

  const intro = useSharedValue(0);
  const glow = useSharedValue(0);
  const sheen = useSharedValue(0);
  const progress = useSharedValue(0);
  const captionFade = useSharedValue(0);

  // Reveal + ambient loops. All transform/opacity, all on the UI thread, so the
  // motion holds 60fps even while the JS thread hydrates caches and auth.
  useEffect(() => {
    intro.value = withTiming(1, { duration: 760, easing: EASE_OUT });
    glow.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    sheen.value = withDelay(
      300,
      withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.cubic) }),
          withTiming(1, { duration: 2400, easing: Easing.linear })
        ),
        -1,
        false
      )
    );
    progress.value = withRepeat(
      withTiming(1, { duration: 1250, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
    captionFade.value = withDelay(280, withTiming(1, { duration: 420, easing: EASE_OUT }));
  }, [intro, glow, sheen, progress, captionFade]);

  // Rotate the cinephile caption with a soft cross-fade.
  useEffect(() => {
    if (phrases.length < 2) return;
    const advance = () => {
      setPhraseIndex((current) => (current + 1) % phrases.length);
      captionFade.value = withTiming(1, { duration: 380, easing: EASE_OUT });
    };
    const id = setInterval(() => {
      captionFade.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(advance)();
      });
    }, 1900);
    return () => clearInterval(id);
  }, [captionFade, phrases.length]);

  const onLockupLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setLockup({ width, height });
  };

  const markStyle = useAnimatedStyle(() => {
    "worklet";
    const e = intro.value;
    return {
      opacity: e,
      transform: [{ scale: 0.86 + e * 0.14 }, { translateY: (1 - e) * 10 }],
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: 0.4 + glow.value * 0.4,
      transform: [{ scale: 0.9 + glow.value * 0.16 }],
    };
  });

  const sheenStyle = useAnimatedStyle(() => {
    "worklet";
    const range = lockup.width * 0.85 + 80;
    return {
      transform: [
        { translateX: interpolate(sheen.value, [0, 1], [-range, range]) },
        { rotate: "18deg" },
      ],
    };
  });

  const captionStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: captionFade.value,
      transform: [{ translateY: (1 - captionFade.value) * 6 }],
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ translateX: interpolate(progress.value, [0, 1], [-56, 132]) }],
    };
  });

  const glowSize = Math.min(windowWidth * 0.78, 300);

  return (
    <Root entering={FadeIn.duration(220)}>
      <BackdropGradient
        colors={[
          theme.colors.background,
          withAlpha(theme.colors.primary, 0.07),
          theme.colors.background,
        ]}
        locations={[0, 0.46, 1]}
      />

      <Center>
        <Glow
          $size={glowSize}
          $color={withAlpha(theme.colors.primary, 0.22)}
          style={glowStyle}
        />

        <Lockup onLayout={onLockupLayout}>
          <MarkRing $color={withAlpha(theme.colors.primary, 0.4)} style={markStyle}>
            <MarkImage source={MARK} resizeMode="contain" />
          </MarkRing>

          <WordRow>
            {WORDMARK.split("").map((char, index) => (
              <WordLetter key={`${char}-${index}`} char={char} index={index} progress={intro} />
            ))}
          </WordRow>

          <Sheen $h={lockup.height} style={sheenStyle} pointerEvents="none">
            <SheenFill
              colors={["transparent", withAlpha("#FFFFFF", 0.16), "transparent"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
            />
          </Sheen>
        </Lockup>

        <Caption style={captionStyle}>{phrases[phraseIndex]}</Caption>

        <ProgressTrack>
          <ProgressChunk style={progressStyle}>
            <ProgressFill
              colors={[
                theme.colors.primaryTransparent,
                theme.colors.primary,
                theme.colors.primaryTransparent,
              ]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
            />
          </ProgressChunk>
        </ProgressTrack>
      </Center>
    </Root>
  );
}

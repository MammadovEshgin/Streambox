import { useEffect, useRef, useState } from "react";
import { Animated, Easing, ImageSourcePropType } from "react-native";
import styled from "styled-components/native";

const ICON_SOURCE: ImageSourcePropType = require("../../../assets/app-icons/app-icon-1024.png");
const MIN_VISIBLE_MS = 900;

const Overlay = styled(Animated.View)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  align-items: center;
  justify-content: center;
  z-index: 999;
`;

const LogoWrap = styled(Animated.View)`
  align-items: center;
  justify-content: center;
`;

const LogoShell = styled.View`
  width: 116px;
  height: 116px;
  border-radius: 28px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.04);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
`;

const LogoImage = styled.Image`
  width: 88px;
  height: 88px;
`;

const Wordmark = styled(Animated.Text)`
  margin-top: 18px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 18px;
  letter-spacing: 1.8px;
  text-transform: uppercase;
`;

type LaunchAnimationOverlayProps = {
  isAppReady: boolean;
  onFinished: () => void;
};

export function LaunchAnimationOverlay({ isAppReady, onFinished }: LaunchAnimationOverlayProps) {
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.92)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const hasExitedRef = useRef(false);

  useEffect(() => {
    const intro = Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        speed: 18,
        bounciness: 6,
        useNativeDriver: true,
      }),
      Animated.timing(wordmarkOpacity, {
        toValue: 1,
        duration: 240,
        delay: 100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    intro.start();
    const timer = setTimeout(() => setMinimumElapsed(true), MIN_VISIBLE_MS);

    return () => {
      clearTimeout(timer);
      intro.stop();
    };
  }, [logoOpacity, logoScale, wordmarkOpacity]);

  useEffect(() => {
    if (!isAppReady || !minimumElapsed || hasExitedRef.current) {
      return;
    }

    hasExitedRef.current = true;
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(wordmarkOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: 1.04,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onFinished();
      }
    });
  }, [isAppReady, logoOpacity, logoScale, minimumElapsed, onFinished, overlayOpacity, wordmarkOpacity]);

  return (
    <Overlay style={{ opacity: overlayOpacity, backgroundColor: "#050505" }} pointerEvents="none">
      <LogoWrap
        style={{
          opacity: logoOpacity,
          transform: [{ scale: logoScale }],
        }}
      >
        <LogoShell>
          <LogoImage source={ICON_SOURCE} resizeMode="contain" />
        </LogoShell>
      </LogoWrap>
      <Wordmark style={{ opacity: wordmarkOpacity }}>StreamBox</Wordmark>
    </Overlay>
  );
}

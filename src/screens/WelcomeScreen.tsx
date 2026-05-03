import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled from "styled-components/native";

import { onboardingPreviewImage } from "../constants/imageAssets";

type WelcomeScreenProps = {
  onContinue: () => void;
};

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Backdrop = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const Glow = styled(Animated.View)<{ $size: number; $top?: number; $left?: number; $right?: number; $opacity?: number }>`
  position: absolute;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  background-color: ${({ theme }) => theme.colors.primary};
  top: ${({ $top = "auto" }) => (typeof $top === "number" ? `${$top}px` : $top)};
  left: ${({ $left = "auto" }) => (typeof $left === "number" ? `${$left}px` : $left)};
  right: ${({ $right = "auto" }) => (typeof $right === "number" ? `${$right}px` : $right)};
  opacity: ${({ $opacity = 0.08 }) => $opacity};
`;

const Content = styled.View<{ $topInset: number; $bottomInset: number }>`
  flex: 1;
  padding: ${({ $topInset }) => $topInset + 12}px 28px ${({ $bottomInset }) => $bottomInset + 18}px;
`;

const TopSpace = styled.View`
  flex: 0.9;
`;

const IllustrationWrap = styled.View`
  align-items: center;
  justify-content: center;
`;

const DeviceShadow = styled(Animated.View)`
  shadow-color: ${({ theme }) => theme.colors.primary};
  shadow-opacity: 0.15;
  shadow-radius: 40px;
  shadow-offset: 0px 8px;
  elevation: 24;
`;

const Device = styled(Animated.View)`
  width: 280px;
  height: 520px;
  border-radius: 38px;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.04);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  shadow-color: #000000;
  shadow-opacity: 0.28;
  shadow-radius: 24px;
  shadow-offset: 0px 16px;
  elevation: 18;
`;

const DeviceScreen = styled(LinearGradient)`
  flex: 1;
  border-radius: 30px;
  overflow: hidden;
  padding: 18px;
`;

const TopBar = styled.View`
  align-items: center;
  justify-content: center;
`;

const TopTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 2px;
  text-transform: uppercase;
`;

const HeroCard = styled.View`
  margin-top: 26px;
  flex: 1;
  border-radius: 26px;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.05);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  padding: 16px;
`;

const HeroTop = styled.View`
  align-items: center;
  padding-top: 8px;
`;

const HeroBrand = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.typography.TitleLarge.fontFamily};
  font-size: 32px;
  line-height: 38px;
  letter-spacing: -1.2px;
`;

const AppPreviewFrame = styled.View`
  flex: 1;
  margin-top: 18px;
  border-radius: 10px;
  overflow: hidden;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  background-color: #000000;
`;

const AppPreviewImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const MiddleSpace = styled.View`
  flex: 0.55;
`;

const CopyBlock = styled(Animated.View)`
  align-items: center;
  justify-content: center;
  padding-horizontal: 8px;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.Display.fontFamily};
  font-size: 26px;
  line-height: 31px;
  letter-spacing: -0.8px;
  text-align: center;
  max-width: 268px;
`;

const TitleAccent = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.typography.Display.fontFamily};
  font-size: 26px;
  line-height: 31px;
  letter-spacing: -0.8px;
  text-align: center;
`;

const Description = styled(Animated.Text)`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.BodyMedium.fontFamily};
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  max-width: 254px;
`;

const BottomSpace = styled.View`
  flex: 0.52;
`;

const Footer = styled(Animated.View)`
  align-items: center;
  justify-content: center;
  min-height: 50px;
`;

const StartButton = styled(Pressable)`
  align-items: center;
  justify-content: center;
  min-height: 48px;
  min-width: 164px;
  flex-direction: row;
  gap: 10px;
  border-radius: 99px;
  background-color: ${({ theme }) => theme.colors.primary};
  padding: 0 24px;
`;

const StartText = styled.Text`
  color: #ffffff;
  font-family: ${({ theme }) => theme.typography.Button.fontFamily};
  font-size: 14px;
  letter-spacing: 0.2px;
`;

const ArrowWrap = styled(Animated.View)``;

export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  // Floating device animation
  const deviceFloat = useSharedValue(0);
  // Glow pulse animations
  const glow1Scale = useSharedValue(1);
  const glow2Scale = useSharedValue(1);
  // Arrow nudge
  const arrowX = useSharedValue(0);

  useEffect(() => {
    // Gentle floating for device
    deviceFloat.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 2400, easing: Easing.inOut(Easing.ease) }),
        withTiming(6, { duration: 2400, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Glow breathing - staggered
    glow1Scale.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    glow2Scale.value = withDelay(
      1500,
      withRepeat(
        withSequence(
          withTiming(1.4, { duration: 3500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 3500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );

    // Arrow bounce hint
    arrowX.value = withDelay(
      1200,
      withRepeat(
        withSequence(
          withTiming(4, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );
  }, [deviceFloat, glow1Scale, glow2Scale, arrowX]);

  const deviceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: deviceFloat.value }],
  }));

  const glow1Style = useAnimatedStyle(() => ({
    transform: [{ scale: glow1Scale.value }],
  }));

  const glow2Style = useAnimatedStyle(() => ({
    transform: [{ scale: glow2Scale.value }],
  }));

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowX.value }],
  }));

  return (
    <Root>
      <Backdrop colors={["#121214", "#0A0A0C", "#050505"]} locations={[0, 0.4, 1]} />
      <Glow style={glow1Style} $size={220} $top={110} $left={-92} $opacity={0.12} />
      <Glow style={glow2Style} $size={160} $top={238} $right={-56} $opacity={0.08} />
      <Glow style={glow1Style} $size={100} $top={600} $right={-30} $opacity={0.06} />

      <Content $topInset={insets.top} $bottomInset={insets.bottom}>
        <TopSpace />

        <IllustrationWrap>
          <DeviceShadow>
            <Device entering={FadeInDown.duration(600).springify().damping(14)} style={deviceStyle}>
              <DeviceScreen colors={["#20140E", "#100D0A", "#090807"]}>
                <TopBar>
                  <TopTitle>{t("welcome.topTitle")}</TopTitle>
                </TopBar>

                <HeroCard>
                  <HeroTop>
                    <HeroBrand>StreamBox</HeroBrand>
                  </HeroTop>

                  <AppPreviewFrame>
                    <AppPreviewImage
                      source={onboardingPreviewImage}
                      resizeMode="contain"
                    />
                  </AppPreviewFrame>
                </HeroCard>
              </DeviceScreen>
            </Device>
          </DeviceShadow>
        </IllustrationWrap>

        <MiddleSpace />

        <CopyBlock entering={FadeInUp.duration(500).delay(300)}>
          <Title>
            {t("welcome.headline")}{"\n"}
            <TitleAccent>{t("welcome.headlineAccent")}</TitleAccent>
          </Title>
          <Description entering={FadeIn.duration(600).delay(600)}>
            {t("welcome.description")}
          </Description>
        </CopyBlock>

        <BottomSpace />

        <Footer entering={FadeInUp.duration(400).delay(800)}>
          <StartButton 
            onPress={onContinue}
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            <StartText>{t("welcome.cta")}</StartText>
            <ArrowWrap style={arrowStyle}>
              <Feather name="arrow-right" size={18} color="#FFFFFF" />
            </ArrowWrap>
          </StartButton>
        </Footer>
      </Content>
    </Root>
  );
}

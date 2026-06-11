import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import styled from "styled-components/native";

type TVWelcomeScreenProps = {
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

const Content = styled.View`
  flex: 1;
  padding: 56px 72px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const Copy = styled.View`
  width: 48%;
`;

const Eyebrow = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_700Bold;
  font-size: 15px;
  letter-spacing: 2px;
  text-transform: uppercase;
`;

const Title = styled.Text`
  margin-top: 18px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 58px;
  line-height: 64px;
  letter-spacing: -1px;
`;

const Subtitle = styled.Text`
  margin-top: 20px;
  width: 86%;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 23px;
  line-height: 34px;
`;

const StartButton = styled.Pressable<{ $focused: boolean }>`
  margin-top: 36px;
  width: 270px;
  height: 70px;
  border-radius: 18px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background-color: ${({ theme }) => theme.colors.primary};
  border-width: ${({ $focused }) => ($focused ? 4 : 0)}px;
  border-color: rgba(255, 255, 255, 0.86);
`;

const StartText = styled.Text`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 22px;
`;

const DevicePanel = styled.View`
  width: 42%;
  aspect-ratio: 16 / 9;
  border-radius: 34px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  padding: 30px;
  overflow: hidden;
`;

const BrandLogo = styled.Image`
  width: 86px;
  height: 86px;
`;

const PanelTitle = styled.Text`
  margin-top: auto;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 36px;
  letter-spacing: -0.5px;
`;

const PanelMeta = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 18px;
`;

export function TVWelcomeScreen({ onContinue }: TVWelcomeScreenProps) {
  const [focused, setFocused] = useState(true);

  return (
    <Root>
      <Backdrop colors={["#111815", "#0D100F", "#050605"]} locations={[0, 0.62, 1]} />
      <Content>
        <Copy>
          <Eyebrow>StreamBox TV</Eyebrow>
          <Title>Movie night, built for the big screen.</Title>
          <Subtitle>
            Browse films, series, and cinematic journeys with a remote-first interface.
          </Subtitle>
          <StartButton
            hasTVPreferredFocus
            focusable
            $focused={focused}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPress={onContinue}
          >
            <StartText>Start watching</StartText>
            <Feather name="arrow-right" size={24} color="#FFFFFF" />
          </StartButton>
        </Copy>
        <DevicePanel>
          <BrandLogo source={require("../../../assets/app-icons/adaptive-foreground.png")} resizeMode="contain" />
          <PanelTitle>StreamBox</PanelTitle>
          <PanelMeta>Remote ready. Landscape first. Fast playback.</PanelMeta>
        </DevicePanel>
      </Content>
    </Root>
  );
}


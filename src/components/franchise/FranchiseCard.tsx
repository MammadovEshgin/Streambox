import { memo } from "react";
import { ImageBackground } from "react-native";
import styled, { useTheme } from "styled-components/native";
import { LinearGradient } from "expo-linear-gradient";

import type { FranchiseCollection } from "../../api/franchises";

const CardPressable = styled.Pressable`
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const CardBackdrop = styled(ImageBackground)`
  width: 100%;
  aspect-ratio: 1.8;
  justify-content: flex-end;
`;

const GradientOverlay = styled(LinearGradient)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 100%;
`;

const CardContent = styled.View`
  padding: 14px 16px 16px;
`;

const FranchiseTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 17px;
  line-height: 22px;
  letter-spacing: -0.3px;
`;

const FranchiseMeta = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: 0.1px;
  margin-top: 3px;
`;

const AccentBar = styled.View<{ $color: string }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background-color: ${({ $color }) => $color};
`;

const EntryCount = styled.View`
  position: absolute;
  top: 10px;
  right: 12px;
  padding: 4px 10px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.55);
`;

const EntryCountText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  letter-spacing: 0.2px;
`;

type FranchiseCardProps = {
  franchise: FranchiseCollection;
  onPress: () => void;
};

function FranchiseCardComponent({ franchise, onPress }: FranchiseCardProps) {
  const theme = useTheme();

  return (
    <CardPressable
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <AccentBar $color={theme.colors.primary} />
      <CardBackdrop
        source={franchise.logoUrl ? { uri: franchise.cachedLogoUrl ?? franchise.logoUrl } : undefined}
        resizeMode="cover"
      >
        <GradientOverlay
          colors={["transparent", "rgba(8, 8, 8, 0.7)", "rgba(8, 8, 8, 0.95)"]}
          locations={[0, 0.5, 1]}
        />
        <EntryCount>
          <EntryCountText>
            {franchise.totalEntries} {franchise.totalEntries === 1 ? "title" : "titles"}
          </EntryCountText>
        </EntryCount>
        <CardContent>
          <FranchiseTitle numberOfLines={1}>{franchise.title}</FranchiseTitle>
          {franchise.description ? (
            <FranchiseMeta numberOfLines={2}>{franchise.description}</FranchiseMeta>
          ) : null}
        </CardContent>
      </CardBackdrop>
    </CardPressable>
  );
}

export const FranchiseCard = memo(FranchiseCardComponent);

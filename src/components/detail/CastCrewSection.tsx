import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useState } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import styled from "styled-components/native";

import { CastMember, CrewMember, getTmdbImageUrl } from "../../api/tmdb";

const Root = styled.View``;

const TabBarContainer = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 12px;
`;

const TabBarBackground = styled.View`
  flex-direction: row;
  background-color: rgba(255, 255, 255, 0.06);
  border-radius: 24px;
  padding: 4px;
`;

const TabButton = styled.Pressable<{ isActive: boolean }>`
  flex: 1;
  padding-horizontal: 16px;
  padding-vertical: 8px;
  align-items: center;
  justify-content: center;
`;

const TabLabel = styled.Text<{ isActive: boolean }>`
  color: ${({ isActive, theme }) => (isActive ? theme.colors.textPrimary : theme.colors.textSecondary)};
  font-size: 14px;
  font-weight: ${({ isActive }) => (isActive ? "700" : "500")};
  letter-spacing: 0.1px;
`;

const TabIndicator = styled(Animated.View)`
  position: absolute;
  background-color: rgba(255, 255, 255, 0.12);
  border-radius: 20px;
`;

const ListContainer = styled.View`
  height: 160px;
`;

// Cast item styles
const CastItemRoot = styled.Pressable`
  width: 86px;
  margin-right: 10px;
`;

const AvatarWrap = styled.View`
  width: 72px;
  height: 72px;
  border-radius: 36px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const Avatar = styled.Image`
  width: 100%;
  height: 100%;
`;

const Placeholder = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const PlaceholderText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  letter-spacing: 0.3px;
`;

const CastActorName = styled.Text`
  margin-top: 7px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  line-height: 14px;
`;

const CharacterName = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 13px;
`;

// Crew item styles
const CrewItemRoot = styled.Pressable`
  width: 86px;
  margin-right: 10px;
`;

const CrewActorName = styled.Text`
  margin-top: 7px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  line-height: 14px;
  font-weight: 700;
`;

const JobTitle = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.primary};
  font-size: 10px;
  line-height: 13px;
`;

type CastCrewSectionProps = {
  cast: CastMember[];
  crew: CrewMember[];
  onPressCastItem?: (item: CastMember) => void;
};

function CastItem({ item, onPressItem }: { item: CastMember; onPressItem?: (item: CastMember) => void }) {
  const avatarUri = getTmdbImageUrl(item.profilePath, "w185");

  return (
    <CastItemRoot onPress={() => onPressItem?.(item)}>
      <AvatarWrap>
        {avatarUri ? (
          <Avatar source={{ uri: avatarUri }} resizeMode="cover" />
        ) : (
          <Placeholder>
            <PlaceholderText>No Image</PlaceholderText>
          </Placeholder>
        )}
      </AvatarWrap>
      <CastActorName numberOfLines={1}>{item.name}</CastActorName>
      <CharacterName numberOfLines={1}>{item.character || "Unknown"}</CharacterName>
    </CastItemRoot>
  );
}

function CrewItem({ item }: { item: CrewMember }) {
  const avatarUri = getTmdbImageUrl(item.profilePath, "w185");

  return (
    <CrewItemRoot>
      <AvatarWrap>
        {avatarUri ? (
          <Avatar source={{ uri: avatarUri }} resizeMode="cover" />
        ) : (
          <Placeholder>
            <PlaceholderText>No Image</PlaceholderText>
          </Placeholder>
        )}
      </AvatarWrap>
      <CrewActorName numberOfLines={1}>{item.name}</CrewActorName>
      <JobTitle numberOfLines={1}>{item.job}</JobTitle>
    </CrewItemRoot>
  );
}

export function CastCrewSection({ cast, crew, onPressCastItem }: CastCrewSectionProps) {
  const isCrewEmpty = crew.length === 0;
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const indicatorWidth = useSharedValue(0);
  const indicatorLeft = useSharedValue(0);

  const renderCastItem = useCallback(
    ({ item }: ListRenderItemInfo<CastMember>) => {
      return <CastItem item={item} onPressItem={onPressCastItem} />;
    },
    [onPressCastItem]
  );

  const renderCrewItem = useCallback(({ item }: ListRenderItemInfo<CrewMember>) => {
    return <CrewItem item={item} />;
  }, []);

  const indicatorStyle = useAnimatedStyle(() => {
    return {
      width: indicatorWidth.value,
      left: indicatorLeft.value
    };
  });

  const handleTabPress = useCallback((tabIndex: number) => {
    setActiveTabIndex(tabIndex);

    // Calculate dimensions for the indicator based on tab index
    const tabWidth = 50; // approximate width per tab
    indicatorWidth.value = withTiming(tabWidth, { duration: 200 });
    indicatorLeft.value = withTiming(tabIndex * (tabWidth + 8) + 4, { duration: 200 });
  }, []);

  return (
    <Root>
      {!isCrewEmpty && (
        <TabBarContainer>
          <TabBarBackground>
            <TabIndicator style={indicatorStyle} />
            <TabButton isActive={activeTabIndex === 0} onPress={() => handleTabPress(0)}>
              <TabLabel isActive={activeTabIndex === 0}>Cast</TabLabel>
            </TabButton>
            <TabButton isActive={activeTabIndex === 1} onPress={() => handleTabPress(1)}>
              <TabLabel isActive={activeTabIndex === 1}>Crew</TabLabel>
            </TabButton>
          </TabBarBackground>
        </TabBarContainer>
      )}
      <ListContainer>
        {activeTabIndex === 0 ? (
          <FlashList
            data={cast}
            horizontal
            keyExtractor={(item) => String(item.id)}
            renderItem={renderCastItem}
            showsHorizontalScrollIndicator={false}
          />
        ) : (
          <FlashList
            data={crew}
            horizontal
            keyExtractor={(item) => String(item.id)}
            renderItem={renderCrewItem}
            showsHorizontalScrollIndicator={false}
          />
        )}
      </ListContainer>
    </Root>
  );
}

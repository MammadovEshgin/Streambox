import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import { CastMember, CrewMember, getTmdbImageUrl } from "../../api/tmdb";
import { CachedRemoteImage } from "../common/CachedRemoteImage";
import { withAlpha } from "../../theme/Theme";

const Root = styled.View``;

const ButtonsContainer = styled.View`
  flex-direction: row;
  gap: 8px;
  margin-bottom: 12px;
`;

const TabButton = styled.Pressable<{ isActive: boolean }>`
  min-height: 32px;
  padding: 7px 14px;
  border-radius: 3px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ isActive, theme }) =>
    isActive ? theme.colors.primaryMuted : theme.colors.glassBorder};
  background-color: ${({ isActive, theme }) =>
    isActive ? theme.colors.primarySoft : theme.colors.glassFill};
`;

const TabLabel = styled.Text<{ isActive: boolean }>`
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  line-height: 15px;
  letter-spacing: 0.2px;
  color: ${({ isActive, theme }) => (isActive ? theme.colors.textPrimary : withAlpha(theme.colors.textPrimary, 0.45))};
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
  align-items: center;
  justify-content: center;
`;

const Avatar = styled(CachedRemoteImage)`
  width: 100%;
  height: 100%;
`;

const PlaceholderIcon = styled.View`
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const CastActorName = styled.Text`
  margin-top: 7px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  line-height: 14px;
`;

const CharacterName = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
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
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  line-height: 14px;
`;

const JobTitle = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 9px;
  line-height: 12px;
`;

type CastCrewSectionProps = {
  cast: CastMember[];
  crew: CrewMember[];
  onPressCastItem?: (item: CastMember) => void;
  onPressCrewItem?: (item: CrewMember) => void;
};

const JOB_PRIORITY: Record<string, number> = {
  "Director": 1,
  "Writer": 2,
  "Screenplay": 2,
  "Art Director": 3,
  "Producer": 4,
  "Executive Producer": 4,
  "Director of Photography": 5,
  "Original Music Composer": 5
};

function getCrewPriority(job: string): number {
  return JOB_PRIORITY[job] ?? 999;
}

function compareByImagePresence(profilePathA: string | null | undefined, profilePathB: string | null | undefined): number {
  const hasImageA = !!profilePathA;
  const hasImageB = !!profilePathB;

  if (hasImageA === hasImageB) {
    return 0;
  }

  return hasImageA ? -1 : 1;
}

function sortCastByImage(cast: CastMember[]): CastMember[] {
  return [...cast].sort((a, b) => {
    return compareByImagePresence(a.profilePath, b.profilePath);
  });
}

function sortCrewByImportance(crew: CrewMember[]): CrewMember[] {
  return [...crew].sort((a, b) => {
    const imageDiff = compareByImagePresence(a.profilePath, b.profilePath);
    if (imageDiff !== 0) return imageDiff;

    const priorityDiff = getCrewPriority(a.job) - getCrewPriority(b.job);
    if (priorityDiff !== 0) return priorityDiff;

    return 0;
  });
}

function CastItem({ item, onPressItem }: { item: CastMember; onPressItem?: (item: CastMember) => void }) {
  const { t } = useTranslation();
  const avatarUri = getTmdbImageUrl(item.profilePath, "w185");

  return (
    <CastItemRoot onPress={() => onPressItem?.(item)}>
      <AvatarWrap>
        {avatarUri ? (
          <Avatar uri={avatarUri} contentFit="cover" recyclingKey={String(item.id)} />
        ) : (
          <PlaceholderIcon>
            <MaterialCommunityIcons name="account-outline" size={32} color="#666666" />
          </PlaceholderIcon>
        )}
      </AvatarWrap>
      <CastActorName numberOfLines={1}>{item.name}</CastActorName>
      <CharacterName numberOfLines={1}>{item.character || t("common.unknown")}</CharacterName>
    </CastItemRoot>
  );
}

function CrewItem({ item, onPressItem }: { item: CrewMember; onPressItem?: (item: CrewMember) => void }) {
  const avatarUri = getTmdbImageUrl(item.profilePath, "w185");

  return (
    <CrewItemRoot onPress={() => onPressItem?.(item)}>
      <AvatarWrap>
        {avatarUri ? (
          <Avatar uri={avatarUri} contentFit="cover" recyclingKey={String(item.id)} />
        ) : (
          <PlaceholderIcon>
            <MaterialCommunityIcons name="account-outline" size={32} color="#666666" />
          </PlaceholderIcon>
        )}
      </AvatarWrap>
      <CrewActorName numberOfLines={1}>{item.name}</CrewActorName>
      <JobTitle numberOfLines={1}>{item.job}</JobTitle>
    </CrewItemRoot>
  );
}

export function CastCrewSection({ cast, crew, onPressCastItem, onPressCrewItem }: CastCrewSectionProps) {
  const { t } = useTranslation();
  const isCrewEmpty = crew.length === 0;
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const sortedCast = sortCastByImage(cast);
  const sortedCrew = sortCrewByImportance(crew);

  const renderCastItem = useCallback(
    ({ item }: ListRenderItemInfo<CastMember>) => {
      return <CastItem item={item} onPressItem={onPressCastItem} />;
    },
    [onPressCastItem]
  );

  const renderCrewItem = useCallback(
    ({ item }: ListRenderItemInfo<CrewMember>) => {
      return <CrewItem item={item} onPressItem={onPressCrewItem} />;
    },
    [onPressCrewItem]
  );

  return (
    <Root>
      {!isCrewEmpty && (
        <ButtonsContainer>
          <TabButton isActive={activeTabIndex === 0} onPress={() => setActiveTabIndex(0)}>
            <TabLabel isActive={activeTabIndex === 0}>{t("detail.cast")}</TabLabel>
          </TabButton>
          <TabButton isActive={activeTabIndex === 1} onPress={() => setActiveTabIndex(1)}>
            <TabLabel isActive={activeTabIndex === 1}>{t("detail.crew")}</TabLabel>
          </TabButton>
        </ButtonsContainer>
      )}
      <ListContainer>
        {activeTabIndex === 0 ? (
          <FlashList
            data={sortedCast}
            horizontal
            keyExtractor={(item) => String(item.id)}
            renderItem={renderCastItem}
            showsHorizontalScrollIndicator={false}
          />
        ) : (
          <FlashList
            data={sortedCrew}
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

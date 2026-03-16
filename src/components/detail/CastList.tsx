import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback } from "react";
import styled from "styled-components/native";

import { CastMember, getTmdbImageUrl } from "../../api/tmdb";

const ItemRoot = styled.Pressable`
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

const ActorName = styled.Text`
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

type CastListProps = {
  cast: CastMember[];
  onPressItem?: (item: CastMember) => void;
};

function CastItem({ item, onPressItem }: { item: CastMember; onPressItem?: (item: CastMember) => void }) {
  const avatarUri = getTmdbImageUrl(item.profilePath, "w185");

  return (
    <ItemRoot onPress={() => onPressItem?.(item)}>
      <AvatarWrap>
        {avatarUri ? (
          <Avatar source={{ uri: avatarUri }} resizeMode="cover" />
        ) : (
          <Placeholder>
            <PlaceholderText>No Image</PlaceholderText>
          </Placeholder>
        )}
      </AvatarWrap>
      <ActorName numberOfLines={1}>{item.name}</ActorName>
      <CharacterName numberOfLines={1}>{item.character || "Unknown"}</CharacterName>
    </ItemRoot>
  );
}

export function CastList({ cast, onPressItem }: CastListProps) {
  const renderItem = useCallback(({ item }: ListRenderItemInfo<CastMember>) => {
    return <CastItem item={item} onPressItem={onPressItem} />;
  }, [onPressItem]);

  return (
    <FlashList
      data={cast}
      horizontal
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
    />
  );
}

import { Feather } from "@expo/vector-icons";
import { memo, useState } from "react";
import type { PressableProps } from "react-native";
import styled from "styled-components/native";

import { formatRating } from "../../api/mediaFormatting";
import { getTmdbImageUrl, type MediaItem } from "../../api/tmdb";
import { CachedRemoteImage } from "../common/CachedRemoteImage";

const TileRoot = styled.Pressable<{ $focused: boolean; $width: number }>`
  width: ${({ $width }) => $width}px;
  margin-right: 22px;
`;

const Artwork = styled.View<{ $focused: boolean; $width: number }>`
  width: ${({ $width }) => $width}px;
  height: ${({ $width }) => Math.round(($width * 9) / 16)}px;
  border-radius: 22px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: ${({ $focused }) => ($focused ? 4 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const BackdropImage = styled(CachedRemoteImage)`
  width: 100%;
  height: 100%;
`;

const EmptyImage = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surfaceHigh};
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textTertiary};
  font-family: Outfit_600SemiBold;
  font-size: 16px;
`;

const Shade = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 62%;
  background-color: rgba(0, 0, 0, 0.42);
`;

const Rating = styled.View`
  position: absolute;
  left: 16px;
  bottom: 14px;
  flex-direction: row;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background-color: rgba(0, 0, 0, 0.64);
`;

const RatingText = styled.Text`
  margin-left: 5px;
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 15px;
`;

const Title = styled.Text`
  margin-top: 14px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  line-height: 28px;
`;

const Meta = styled.Text`
  margin-top: 3px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 16px;
`;

type TVMediaTileProps = {
  item: MediaItem;
  width?: number;
  preferredFocus?: boolean;
  onPress?: PressableProps["onPress"];
  onFocus?: () => void;
};

function TVMediaTileComponent({ item, width = 320, preferredFocus, onPress, onFocus }: TVMediaTileProps) {
  const [focused, setFocused] = useState(false);
  const imageUri = getTmdbImageUrl(item.backdropPath ?? item.posterPath, item.backdropPath ? "w780" : "w500");

  return (
    <TileRoot
      $focused={focused}
      $width={width}
      focusable
      hasTVPreferredFocus={preferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={{ transform: [{ scale: focused ? 1.045 : 1 }] }}
    >
      <Artwork $focused={focused} $width={width}>
        {imageUri ? (
          <BackdropImage uri={imageUri} contentFit="cover" />
        ) : (
          <EmptyImage>
            <EmptyText>No artwork</EmptyText>
          </EmptyImage>
        )}
        <Shade />
        {typeof item.id !== "string" ? (
          <Rating>
            <Feather name="star" size={15} color="#FFD45A" />
            <RatingText>{formatRating(item.rating)}</RatingText>
          </Rating>
        ) : null}
      </Artwork>
      <Title numberOfLines={1}>{item.title}</Title>
      <Meta>{typeof item.rank === "number" ? `${item.year}  ·  #${item.rank}` : item.year}</Meta>
    </TileRoot>
  );
}

export const TVMediaTile = memo(TVMediaTileComponent);

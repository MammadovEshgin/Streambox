import { Feather } from "@expo/vector-icons";
import { memo } from "react";
import { PressableProps } from "react-native";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import { MediaItem, getTmdbImageUrl } from "../../api/tmdb";
import { formatRating } from "../../api/mediaFormatting";
import { CachedRemoteImage } from "../common/CachedRemoteImage";

const CardRoot = styled.Pressable`
  width: 132px;
`;

const PosterFrame = styled.View`
  position: relative;
  width: 132px;
  height: 198px;
  border-radius: 14px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const PosterImage = styled(CachedRemoteImage)`
  width: 100%;
  height: 100%;
`;

const NoImage = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const NoImageText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
`;

const Badge = styled.View`
  position: absolute;
  left: 8px;
  bottom: 8px;
  flex-direction: row;
  align-items: center;
  padding: 4px 9px;
  border-radius: 999px;
  background-color: rgba(0, 0, 0, 0.72);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.10);
`;

const BadgeValue = styled.Text`
  color: #FFFFFF;
  font-family: Outfit_600SemiBold;
  font-size: 12px;
  letter-spacing: 0.2px;
`;

const Title = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
  line-height: 18px;
  letter-spacing: -0.15px;
`;

const MetaRow = styled.View`
  margin-top: 4px;
`;

const Meta = styled.Text`
  color: ${({ theme }) => theme.colors.textTertiary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 10px;
  line-height: 14px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
`;

type MediaCardProps = {
  item: MediaItem;
  onPress?: PressableProps["onPress"];
  onPressIn?: PressableProps["onPressIn"];
  posterUri?: string;
  hideRating?: boolean;
};

function MediaCardComponent({ item, onPress, onPressIn, posterUri: customPosterUri, hideRating }: MediaCardProps) {
  const { t } = useTranslation();
  const posterUri = customPosterUri ?? getTmdbImageUrl(item.posterPath, "w342");
  const ratingText = formatRating(item.rating);

  return (
    <CardRoot
      onPress={onPress}
      onPressIn={onPressIn}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.96 : 1 }]}
    >
      <PosterFrame>
        {posterUri ? (
          <PosterImage uri={posterUri} contentFit="cover" />
        ) : (
          <NoImage>
            <NoImageText>{t("common.noImage")}</NoImageText>
          </NoImage>
        )}
        {!hideRating && typeof item.id !== "string" && !item.imdbId?.startsWith("az-") && (
          <Badge>
            <Feather name="star" size={11} color="#FFD700" style={{ marginRight: 4 }} />
            <BadgeValue style={{ fontVariant: ["tabular-nums"] }}>{ratingText}</BadgeValue>
          </Badge>
        )}
      </PosterFrame>
      <Title numberOfLines={1}>{item.title}</Title>
      <MetaRow>
        <Meta style={{ fontVariant: ["tabular-nums"] }}>
          {typeof item.rank === "number" ? `${item.year}  ·  #${item.rank}` : item.year}
        </Meta>
      </MetaRow>
    </CardRoot>
  );
}

export const MediaCard = memo(MediaCardComponent, (prev, next) => {
  return (
    prev.item === next.item &&
    prev.onPress === next.onPress &&
    prev.onPressIn === next.onPressIn &&
    prev.posterUri === next.posterUri &&
    prev.hideRating === next.hideRating
  );
});

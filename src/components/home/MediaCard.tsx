import { Feather } from "@expo/vector-icons";
import { PressableProps } from "react-native";
import styled from "styled-components/native";

import { MediaItem, getTmdbImageUrl } from "../../api/tmdb";

const CardRoot = styled.Pressable`
  width: 132px;
`;

const PosterFrame = styled.View`
  position: relative;
  width: 132px;
  height: 198px;
  border-radius: 12px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const PosterImage = styled.Image`
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
  font-size: 12px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
`;

const Badge = styled.View`
  position: absolute;
  left: 8px;
  bottom: 8px;
  flex-direction: row;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background-color: rgba(0, 0, 0, 0.68);
`;

const BadgeValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 12px;
  letter-spacing: 0.2px;
`;

const Title = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.BodySmall.fontFamily};
  font-size: 14px;
  line-height: 19px;
  letter-spacing: -0.15px;
`;

const MetaRow = styled.View`
  margin-top: 3px;
`;

const Meta = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.3px;
`;

type MediaCardProps = {
  item: MediaItem;
  onPress?: PressableProps["onPress"];
  onPressIn?: PressableProps["onPressIn"];
  posterUri?: string;
  hideRating?: boolean;
};

export function MediaCard({ item, onPress, onPressIn, posterUri: customPosterUri, hideRating }: MediaCardProps) {
  const posterUri = customPosterUri ?? getTmdbImageUrl(item.posterPath, "w342");
  const ratingText = item.rating.toFixed(1);

  return (
    <CardRoot
      onPress={onPress}
      onPressIn={onPressIn}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : 1 }] }]}
    >
      <PosterFrame>
        {posterUri ? (
          <PosterImage source={{ uri: posterUri }} resizeMode="cover" />
        ) : (
          <NoImage>
            <NoImageText>No Image</NoImageText>
          </NoImage>
        )}
        {!hideRating && typeof item.id !== "string" && !item.imdbId?.startsWith("az-") && (
          <Badge>
            <Feather name="star" size={11} color="#FFD700" style={{ marginRight: 4 }} />
            <BadgeValue>{ratingText}</BadgeValue>
          </Badge>
        )}
      </PosterFrame>
      <Title numberOfLines={1}>{item.title}</Title>
      <MetaRow>
        <Meta>{typeof item.rank === "number" ? `${item.year} | #${item.rank}` : item.year}</Meta>
      </MetaRow>
    </CardRoot>
  );
}

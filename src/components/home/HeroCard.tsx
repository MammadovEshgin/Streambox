import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import styled from "styled-components/native";

import { MediaItem, getTmdbImageUrl } from "../../api/tmdb";

const HeroRoot = styled.View`
  position: relative;
  min-height: 228px;
  border-radius: 16px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const BackdropImage = styled.Image`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

const FrostedLayer = styled(BlurView).attrs({
  intensity: 42,
  tint: "dark"
})`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

const Shade = styled.View`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.35);
`;

const Content = styled.View`
  flex: 1;
  justify-content: flex-end;
  padding: 18px;
`;

const Eyebrow = styled.Text`
  color: #ffd700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1.1px;
  font-weight: 700;
`;

const Title = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 30px;
  line-height: 34px;
  font-weight: 700;
  letter-spacing: -0.5px;
`;

const MetaRow = styled.View`
  margin-top: 8px;
  flex-direction: row;
  align-items: center;
`;

const Meta = styled.Text`
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  line-height: 18px;
`;

const EmptyState = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  letter-spacing: 0.25px;
`;

type HeroCardProps = {
  item: MediaItem | null;
};

export function HeroCard({ item }: HeroCardProps) {
  if (!item) {
    return (
      <HeroRoot>
        <EmptyState>
          <EmptyText>No featured media</EmptyText>
        </EmptyState>
      </HeroRoot>
    );
  }

  const backdropUri = getTmdbImageUrl(item.backdropPath ?? item.posterPath, "w780");
  const ratingLabel = item.rating.toFixed(1);

  return (
    <HeroRoot>
      {backdropUri ? <BackdropImage source={{ uri: backdropUri }} resizeMode="cover" /> : null}
      <FrostedLayer />
      <Shade />
      <Content>
        <Eyebrow>Featured Now</Eyebrow>
        <Title numberOfLines={2}>{item.title}</Title>
        <MetaRow>
          <Meta>{item.year} | </Meta>
          <Feather name="star" size={12} color="#FFD700" />
          <Meta> {ratingLabel}</Meta>
        </MetaRow>
      </Content>
    </HeroRoot>
  );
}

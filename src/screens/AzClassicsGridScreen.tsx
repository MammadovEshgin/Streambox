import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import { AzClassicMovie, getAzClassics } from "../api/azClassics";
import { getTmdbImageUrl } from "../api/tmdb";
import { SafeContainer } from "../components/common/SafeContainer";
import { HomeStackParamList } from "../navigation/types";

const GRID_COLUMNS = 3;
const GRID_GAP = 10;
const HORIZONTAL_PADDING = 16;
const BOTTOM_PADDING = 24;

const Root = styled.View`
  flex: 1;
`;

const Header = styled.View`
  padding: 8px 16px 14px;
  flex-direction: row;
  align-items: center;
`;

const BackButton = styled.Pressable`
  width: 34px;
  height: 34px;
  border-radius: 10px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.06);
`;

const HeaderTextWrap = styled.View`
  margin-left: 12px;
  flex: 1;
`;

const HeaderTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  line-height: 22px;
  font-family: Outfit_700Bold;
  letter-spacing: -0.3px;
`;

const CardPressable = styled.Pressable`
  width: 100%;
  margin-bottom: 12px;
  padding: 0 ${GRID_GAP / 2}px;
`;

const PosterFrame = styled.View`
  width: 100%;
  aspect-ratio: 0.6667;
  border-radius: 8px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
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
  font-size: 11px;
  letter-spacing: 0.2px;
  text-transform: uppercase;
`;

const CardTitle = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 16px;
  font-family: Outfit_600SemiBold;
  letter-spacing: -0.2px;
`;

const CardMeta = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 14px;
`;

type AzClassicsGridProps = NativeStackScreenProps<HomeStackParamList, "AzClassicsGrid">;

export function AzClassicsGridScreen({ navigation }: AzClassicsGridProps) {
  const { t } = useTranslation();
  const movies = useMemo(() => getAzClassics(), []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AzClassicMovie>) => {
      const posterUri = getTmdbImageUrl(item.posterPath, "w342");
      return (
        <CardPressable onPress={() => navigation.navigate("AzClassicDetail", { id: item.id })}>
          <PosterFrame>
            {posterUri ? (
              <PosterImage source={{ uri: posterUri }} resizeMode="cover" />
            ) : (
              <NoImage>
                <NoImageText>{t("common.noImage")}</NoImageText>
              </NoImage>
            )}
          </PosterFrame>
          <CardTitle numberOfLines={1}>{item.title}</CardTitle>
          <CardMeta>{item.year ?? ""}</CardMeta>
        </CardPressable>
      );
    },
    [navigation, t]
  );

  return (
    <SafeContainer>
      <Root>
        <Header>
          <BackButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </BackButton>
          <HeaderTextWrap>
            <HeaderTitle>{t("movies.azClassics")}</HeaderTitle>
          </HeaderTextWrap>
        </Header>

        <FlashList
          data={movies}
          numColumns={GRID_COLUMNS}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING - GRID_GAP / 2,
            paddingBottom: BOTTOM_PADDING,
          }}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
        />
      </Root>
    </SafeContainer>
  );
}

import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useState } from "react";
import styled from "styled-components/native";

import {
  FranchiseCollection,
  getFranchiseCollections,
  prefetchFranchiseEntries,
  refreshFranchiseCollections,
} from "../api/franchises";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { HomeStackParamList } from "../navigation/types";

const GRID_COLUMNS = 3;
const GRID_GAP = 10;

const Root = styled.View`
  flex: 1;
`;

const Header = styled.View`
  padding: 8px 16px 6px;
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

const HeaderSubtitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 16px;
  font-family: Outfit_400Regular;
  letter-spacing: 0.15px;
  margin-top: 1px;
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

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
`;

const EmptyTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 16px;
  letter-spacing: -0.2px;
  margin-top: 16px;
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  text-align: center;
  margin-top: 6px;
  line-height: 19px;
`;

const ErrorWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
`;

const ErrorText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 14px;
  text-align: center;
  margin-top: 12px;
`;

const RetryButton = styled.Pressable`
  margin-top: 16px;
  padding: 10px 24px;
  border-radius: 12px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const RetryText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
`;

type FranchiseCatalogProps = NativeStackScreenProps<HomeStackParamList, "FranchiseCatalog">;

export function FranchiseCatalogScreen({ navigation }: FranchiseCatalogProps) {
  const [franchises, setFranchises] = useState<FranchiseCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await getFranchiseCollections();
      setFranchises(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load franchises.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;

    void refreshFranchiseCollections()
      .then((freshCollections) => {
        if (!active) return;
        setFranchises((currentCollections) => {
          const currentSignature = JSON.stringify(
            currentCollections.map((item) => [
              item.id,
              item.title,
              item.sortOrder,
              item.totalEntries,
              item.logoUrl,
              item.cachedLogoUrl,
            ])
          );
          const freshSignature = JSON.stringify(
            freshCollections.map((item) => [
              item.id,
              item.title,
              item.sortOrder,
              item.totalEntries,
              item.logoUrl,
              item.cachedLogoUrl,
            ])
          );
          return currentSignature === freshSignature ? currentCollections : freshCollections;
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const handlePressCard = useCallback(
    (franchise: FranchiseCollection) => {
      navigation.navigate("FranchiseTimeline", {
        franchiseId: franchise.id,
        franchiseTitle: franchise.title,
        accentColor: franchise.accentColor ?? undefined,
      });
    },
    [navigation]
  );

  const handlePressInCard = useCallback((franchiseId: string) => {
    prefetchFranchiseEntries(franchiseId);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FranchiseCollection>) => {
      return (
        <CardPressable
          onPress={() => handlePressCard(item)}
          onPressIn={() => handlePressInCard(item.id)}
        >
          <PosterFrame>
            {item.logoUrl ? (
              <PosterImage source={{ uri: item.cachedLogoUrl ?? item.logoUrl }} resizeMode="cover" />
            ) : (
              <NoImage>
                <NoImageText>No Image</NoImageText>
              </NoImage>
            )}
          </PosterFrame>
          <CardTitle>{item.title}</CardTitle>
        </CardPressable>
      );
    },
    [handlePressCard, handlePressInCard]
  );

  if (isLoading) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label="Loading journeys" />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  if (errorMessage) {
    return (
      <SafeContainer>
        <Root>
          <Header>
            <BackButton onPress={() => navigation.goBack()}>
              <Feather name="arrow-left" size={18} color="#FFFFFF" />
            </BackButton>
            <HeaderTextWrap>
              <HeaderTitle>Cinematic Journeys</HeaderTitle>
            </HeaderTextWrap>
          </Header>
          <ErrorWrap>
            <Feather name="alert-circle" size={36} color="rgba(255,255,255,0.3)" />
            <ErrorText>{errorMessage}</ErrorText>
            <RetryButton onPress={load}>
              <RetryText>Retry</RetryText>
            </RetryButton>
          </ErrorWrap>
        </Root>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <Root>
        <Header>
          <BackButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </BackButton>
          <HeaderTextWrap>
            <HeaderTitle>Cinematic Journeys</HeaderTitle>
            <HeaderSubtitle>Watch franchises in the right order</HeaderSubtitle>
          </HeaderTextWrap>
        </Header>

        {franchises.length === 0 ? (
          <EmptyWrap>
            <Feather name="film" size={36} color="rgba(255,255,255,0.2)" />
            <EmptyTitle>No Journeys Yet</EmptyTitle>
            <EmptyText>
              Franchise roadmaps will appear here once they are added to the collection.
            </EmptyText>
          </EmptyWrap>
        ) : (
          <FlashList
            data={franchises}
            numColumns={GRID_COLUMNS}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{
              paddingHorizontal: 16 - GRID_GAP / 2,
              paddingTop: 12,
              paddingBottom: 40,
            }}
          />
        )}
      </Root>
    </SafeContainer>
  );
}

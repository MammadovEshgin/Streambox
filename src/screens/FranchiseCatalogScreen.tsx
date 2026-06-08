import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import {
  FranchiseCollection,
  getFranchiseCollections,
  prefetchFranchiseEntries,
  refreshFranchiseCollections,
} from "../api/franchises";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { franchiseCardBackgroundImage } from "../constants/imageAssets";
import { useAuth } from "../context/AuthContext";
import { useUserDataSync } from "../context/UserDataSyncContext";
import { HomeStackParamList } from "../navigation/types";
import { formatFranchiseCollectionTitle } from "../services/franchiseLocalization";
import { useAppSettings } from "../settings/AppSettingsContext";

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
  border-radius: 14px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
`;

const FranchisePosterImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const CardTitle = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  line-height: 18px;
  font-family: Outfit_600SemiBold;
  letter-spacing: -0.15px;
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
  const { t } = useTranslation();
  const { language } = useAppSettings();
  const { user } = useAuth();
  const { isReady: isUserDataReady } = useUserDataSync();
  const [franchises, setFranchises] = useState<FranchiseCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idlePrefetchedFranchiseIdsRef = useRef<Set<string>>(new Set());

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
              item.accentColor,
            ])
          );
          const freshSignature = JSON.stringify(
            freshCollections.map((item) => [
              item.id,
              item.title,
              item.sortOrder,
              item.totalEntries,
              item.accentColor,
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

  useEffect(() => {
    if (!isUserDataReady || franchises.length === 0) {
      return;
    }

    const prefetchScope = user?.id ?? "anon";
    const idsToPrefetch = franchises
      .slice(0, GRID_COLUMNS * 3)
      .map((franchise) => franchise.id)
      .filter((id) => !idlePrefetchedFranchiseIdsRef.current.has(`${prefetchScope}:${id}`));

    if (idsToPrefetch.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      idsToPrefetch.forEach((id) => {
        idlePrefetchedFranchiseIdsRef.current.add(`${prefetchScope}:${id}`);
        prefetchFranchiseEntries(id, user?.id);
      });
    }, 900);

    return () => {
      clearTimeout(timer);
    };
  }, [franchises, isUserDataReady, user?.id]);

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
    prefetchFranchiseEntries(franchiseId, user?.id);
  }, [user?.id]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FranchiseCollection>) => {
      return (
        <CardPressable
          onPress={() => handlePressCard(item)}
          onPressIn={() => handlePressInCard(item.id)}
        >
          <PosterFrame>
            <FranchisePosterImage source={franchiseCardBackgroundImage} resizeMode="cover" />
          </PosterFrame>
          <CardTitle>{formatFranchiseCollectionTitle(item.title, language)}</CardTitle>
        </CardPressable>
      );
    },
    [handlePressCard, handlePressInCard, language]
  );

  if (isLoading) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label={t("loaders.loadingJourneys")} />
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
              <HeaderTitle>{t("franchise.title")}</HeaderTitle>
            </HeaderTextWrap>
          </Header>
          <ErrorWrap>
            <Feather name="alert-circle" size={36} color="rgba(255,255,255,0.3)" />
            <ErrorText>{errorMessage}</ErrorText>
            <RetryButton onPress={load}>
              <RetryText>{t("common.retry")}</RetryText>
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
            <HeaderTitle>{t("franchise.title")}</HeaderTitle>
            <HeaderSubtitle>{t("franchise.subtitle")}</HeaderSubtitle>
          </HeaderTextWrap>
        </Header>

        {franchises.length === 0 ? (
          <EmptyWrap>
            <Feather name="film" size={36} color="rgba(255,255,255,0.2)" />
            <EmptyTitle>{t("franchise.emptyTitle")}</EmptyTitle>
            <EmptyText>
              {t("franchise.emptyDescription")}
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

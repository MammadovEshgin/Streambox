import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput as RNTextInput,
  View
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { MediaItem, getTmdbImageUrl, searchMulti } from "../../api/tmdb";
import { formatRating } from "../../api/mediaFormatting";

/* ------------------------------------------------------------------ */
/*  Styled Components                                                 */
/* ------------------------------------------------------------------ */

const HeaderRoot = styled.View`
  margin-top: 6px;
  margin-bottom: 14px;
  z-index: 100;
`;

const SearchRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const SearchField = styled.View<{ $focused: boolean }>`
  flex: 1;
  height: 50px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${({ theme, $focused }) =>
    $focused ? theme.colors.primary : theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  flex-direction: row;
  align-items: center;
  padding: 0 18px;
`;

const SearchIcon = styled.View`
  margin-right: 10px;
`;

/* SearchInput is rendered inline as a plain RNTextInput to support ref forwarding */

const ClearButton = styled(Pressable)`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.border};
  align-items: center;
  justify-content: center;
  margin-left: 8px;
`;

const FilterButton = styled(Pressable) <{ $active: boolean }>`
  width: 50px;
  height: 50px;
  margin-left: 10px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.border};
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primarySoft : theme.colors.surface};
  align-items: center;
  justify-content: center;
`;

/* ------------------------------------------------------------------ */
/*  Search Results Dropdown                                           */
/* ------------------------------------------------------------------ */

const SCREEN_HEIGHT = Dimensions.get("window").height;
const DROPDOWN_MAX_HEIGHT = SCREEN_HEIGHT * 0.65;

const ResultsContainer = styled(Animated.View)`
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  max-height: ${DROPDOWN_MAX_HEIGHT}px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
  elevation: 10;
  shadow-color: #000;
  shadow-offset: 0px 4px;
  shadow-opacity: 0.3;
  shadow-radius: 8px;
`;

const ResultsScroll = styled(ScrollView).attrs({
  nestedScrollEnabled: true,
  keyboardShouldPersistTaps: "always",
  showsVerticalScrollIndicator: true,
  bounces: false,
  contentContainerStyle: { flexGrow: 1, paddingBottom: 16 },
})`
  max-height: ${DROPDOWN_MAX_HEIGHT}px;
  width: 100%;
`;

const ResultRow = styled(Pressable)`
  flex-direction: row;
  align-items: center;
  padding: 10px 14px;
`;

const ResultSeparator = styled.View`
  height: 1px;
  margin-left: 72px;
  background-color: ${({ theme }) => theme.colors.border};
`;

const PosterImage = styled(Image)`
  width: 44px;
  height: 66px;
  border-radius: 6px;
  background-color: ${({ theme }) => theme.colors.border};
`;

const PosterPlaceholder = styled.View`
  width: 44px;
  height: 66px;
  border-radius: 6px;
  background-color: ${({ theme }) => theme.colors.border};
  align-items: center;
  justify-content: center;
`;

const ResultInfo = styled.View`
  flex: 1;
  margin-left: 14px;
`;

const ResultTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 15px;
  line-height: 20px;
`;

const ResultMeta = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  margin-top: 3px;
`;

const ResultRating = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 4px;
`;

const RatingText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 12px;
  margin-left: 4px;
`;

const MediaTypeBadge = styled.View`
  padding: 2px 8px;
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.primary}20;
  align-self: flex-start;
  margin-top: 4px;
`;

const MediaTypeBadgeText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_500Medium;
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
`;

const LoadingRow = styled.View`
  padding: 20px;
  align-items: center;
  justify-content: center;
`;

const EmptyRow = styled.View`
  padding: 24px 14px;
  align-items: center;
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  text-align: center;
`;

const SearchHintRow = styled.View`
  padding: 16px 14px;
  flex-direction: row;
  align-items: center;
`;

const SearchHintText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  margin-left: 10px;
`;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type HomeHeaderProps = {
  query: string;
  onChangeQuery: (value: string) => void;
  onOpenFilter?: () => void;
  onSearchSubmit?: (query: string) => void;
  onSelectItem?: (item: MediaItem) => void;
  hasActiveFilters?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function HomeHeader({
  query,
  onChangeQuery,
  onOpenFilter,
  onSearchSubmit,
  onSelectItem,
  hasActiveFilters = false,
}: HomeHeaderProps) {
  const currentTheme = useTheme();
  const { t } = useTranslation();
  const inputRef = useRef<RNTextInput>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [results, setResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

  const showDropdown = isFocused && query.trim().length > 0;


  // Debounced live search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      setCurrentPage(1);
      setTotalPages(0);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await searchMulti(trimmed, 1);
        lastQueryRef.current = trimmed;
        setResults(response.items);
        setCurrentPage(1);
        setTotalPages(response.totalPages);
        setHasSearched(true);
      } catch {
        setResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Load next page when scrolling to the end
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || currentPage >= totalPages) return;

    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const response = await searchMulti(lastQueryRef.current, nextPage);
      setResults((prev) => [...prev, ...response.items]);
      setCurrentPage(nextPage);
      setTotalPages(response.totalPages);
    } catch {
      // silently fail — user can retry by scrolling again
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, currentPage, totalPages]);

  const handleClear = useCallback(() => {
    onChangeQuery("");
    setResults([]);
    setHasSearched(false);
    setCurrentPage(1);
    setTotalPages(0);
    inputRef.current?.focus();
  }, [onChangeQuery]);

  const handleSubmit = useCallback(() => {
    if (query.trim()) {
      Keyboard.dismiss();
      setIsFocused(false);
      onSearchSubmit?.(query.trim());
    }
  }, [query, onSearchSubmit]);

  const handleSelectItem = useCallback(
    (item: MediaItem) => {
      Keyboard.dismiss();
      setIsFocused(false);
      onSelectItem?.(item);
    },
    [onSelectItem]
  );

  const handleFilterPress = () => {
    Keyboard.dismiss();
    setIsFocused(false);
    onOpenFilter?.();
  };

  const renderResultItem = useCallback(
    (item: MediaItem) => {
      const posterUri = getTmdbImageUrl(item.posterPath, "w185");

      return (
        <ResultRow onPress={() => handleSelectItem(item)}>
          {posterUri ? (
            <PosterImage source={{ uri: posterUri }} resizeMode="cover" />
          ) : (
            <PosterPlaceholder>
              <Feather name="film" size={18} color={currentTheme.colors.textSecondary} />
            </PosterPlaceholder>
          )}
          <ResultInfo>
            <ResultTitle numberOfLines={1}>{item.title}</ResultTitle>
            <ResultMeta>{item.year !== "----" ? item.year : t("common.unknownYear")}</ResultMeta>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {typeof item.rating === "number" && item.rating > 0 && (
                <ResultRating>
                  <Feather name="star" size={11} color={currentTheme.colors.primary} />
                  <RatingText>{formatRating(item.rating)}</RatingText>
                </ResultRating>
              )}
              <MediaTypeBadge>
                <MediaTypeBadgeText>
                  {item.mediaType === "movie" ? t("common.movie") : t("common.series")}
                </MediaTypeBadgeText>
              </MediaTypeBadge>
            </View>
          </ResultInfo>
          <Feather name="chevron-right" size={18} color={currentTheme.colors.textSecondary} />
        </ResultRow>
      );
    },
    [handleSelectItem, currentTheme]
  );

  return (
    <HeaderRoot>
      <SearchRow>
        <SearchField $focused={isFocused}>
          <SearchIcon>
            <Feather
              name="search"
              size={18}
              color={isFocused ? currentTheme.colors.primary : currentTheme.colors.textSecondary}
            />
          </SearchIcon>
          <RNTextInput
            ref={inputRef}
            value={query}
            onChangeText={onChangeQuery}
            placeholder={t("search.placeholder")}
            placeholderTextColor={currentTheme.colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              // Longer delay to ensure scroll gestures on the results aren't cut off
              setTimeout(() => setIsFocused(false), 500);
            }}
            onSubmitEditing={handleSubmit}
            style={{
              flex: 1,
              color: currentTheme.colors.textPrimary,
              fontFamily: "Outfit_400Regular",
              fontSize: 15,
              letterSpacing: 0.1,
              padding: 0
            }}
          />
          {query.length > 0 && (
            <ClearButton onPress={handleClear}>
              <Feather name="x" size={14} color={currentTheme.colors.textPrimary} />
            </ClearButton>
          )}
        </SearchField>
        <FilterButton $active={hasActiveFilters} onPress={handleFilterPress}>
          <Feather
            name="sliders"
            size={20}
            color={hasActiveFilters ? currentTheme.colors.primary : currentTheme.colors.textSecondary}
          />
        </FilterButton>
      </SearchRow>

      {showDropdown && (
        <ResultsContainer
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(100)}
          pointerEvents="box-none"
        >
          {isSearching && results.length === 0 ? (
            <LoadingRow>
              <ActivityIndicator color={currentTheme.colors.primary} size="small" />
            </LoadingRow>
          ) : hasSearched && results.length === 0 ? (
            <EmptyRow>
              <Feather name="search" size={24} color={currentTheme.colors.textSecondary} />
              <EmptyText style={{ marginTop: 8 }}>
                {t("search.noResultsForQuery", { query: query.trim() })}
              </EmptyText>
              <EmptyText style={{ fontSize: 12, marginTop: 4 }}>
                {t("search.tryDifferentKeywords")}
              </EmptyText>
            </EmptyRow>
          ) : results.length > 0 ? (
            <ResultsScroll
              onScroll={({ nativeEvent }) => {
                const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                const isNearEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - 100;
                if (isNearEnd) handleLoadMore();
              }}
              scrollEventThrottle={400}
            >
              {results.map((item, index) => (
                <View key={`${item.mediaType}-${item.id}`}>
                  {index > 0 && <ResultSeparator />}
                  {renderResultItem(item)}
                </View>
              ))}
              {isLoadingMore && (
                <LoadingRow>
                  <ActivityIndicator color={currentTheme.colors.primary} size="small" />
                </LoadingRow>
              )}
              {query.trim().length >= 2 && (
                <SearchHintRow>
                  <Feather name="corner-down-left" size={14} color={currentTheme.colors.textSecondary} />
                  <SearchHintText>{t("search.pressEnterForFullResults")}</SearchHintText>
                </SearchHintRow>
              )}
            </ResultsScroll>
          ) : (
            <SearchHintRow>
              <Feather name="search" size={14} color={currentTheme.colors.textSecondary} />
              <SearchHintText>{t("search.typeAtLeastTwoChars")}</SearchHintText>
            </SearchHintRow>
          )}
        </ResultsContainer>
      )}
    </HeaderRoot>
  );
}







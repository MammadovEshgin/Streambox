import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, TextInput } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { searchMulti, type MediaItem } from "../../api/tmdb";
import { TVMediaTile } from "../../components/tv/TVMediaTile";
import type { TVStackParamList } from "../../navigation/TVNavigation";

type TVSearchScreenProps = NativeStackScreenProps<TVStackParamList, "TVSearch">;

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  padding: 42px 64px 36px;
`;

const TopBar = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 18px;
`;

const BackButton = styled.Pressable<{ $focused: boolean }>`
  width: 58px;
  height: 58px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: ${({ $focused }) => ($focused ? 3 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const SearchBox = styled.View<{ $focused: boolean }>`
  flex: 1;
  height: 64px;
  border-radius: 20px;
  flex-direction: row;
  align-items: center;
  gap: 13px;
  padding: 0 22px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: ${({ $focused }) => ($focused ? 3 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const Input = styled(TextInput)`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 24px;
`;

const ResultsTitle = styled.Text`
  margin-top: 36px;
  margin-bottom: 18px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 34px;
  letter-spacing: -0.7px;
`;

const GridWrap = styled.View`
  flex: 1;
`;

const Cell = styled.View`
  margin-bottom: 30px;
`;

const EmptyState = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EmptyTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 30px;
`;

const EmptyText = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 20px;
`;

export function TVSearchScreen({ navigation, route }: TVSearchScreenProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [backFocused, setBackFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [query, setQuery] = useState(route.params?.initialQuery ?? "");
  const [submittedQuery, setSubmittedQuery] = useState(route.params?.initialQuery ?? "");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    setSubmittedQuery(trimmed);
    if (!trimmed) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      const response = await searchMulti(trimmed, 1);
      setItems(response.items.filter((item) => item.backdropPath || item.posterPath).slice(0, 36));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route.params?.initialQuery) {
      void runSearch(route.params.initialQuery);
    }
  }, [route.params?.initialQuery, runSearch]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => (
      <Cell>
        <TVMediaTile
          item={item}
          width={286}
          onPress={() => navigation.navigate("TVDetail", { mediaType: item.mediaType, id: String(item.id) })}
        />
      </Cell>
    ),
    [navigation]
  );

  return (
    <Root>
      <TopBar>
        <BackButton
          focusable
          $focused={backFocused}
          onFocus={() => setBackFocused(true)}
          onBlur={() => setBackFocused(false)}
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={27} color={backFocused ? theme.colors.primary : theme.colors.textPrimary} />
        </BackButton>
        <SearchBox $focused={inputFocused}>
          <Feather name="search" size={24} color={inputFocused ? theme.colors.primary : theme.colors.textSecondary} />
          <Input
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search movies, series, or actors"
            placeholderTextColor={theme.colors.textTertiary}
            returnKeyType="search"
            autoFocus
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSubmitEditing={() => void runSearch(query)}
          />
        </SearchBox>
      </TopBar>

      <ResultsTitle>
        {submittedQuery ? `Results for "${submittedQuery}"` : "Search StreamBox"}
      </ResultsTitle>

      <GridWrap>
        {loading ? (
          <EmptyState>
            <ActivityIndicator color={theme.colors.primary} size="large" />
            <EmptyText>Searching titles</EmptyText>
          </EmptyState>
        ) : items.length > 0 ? (
          <FlashList
            data={items}
            numColumns={3}
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <EmptyState>
            <EmptyTitle>{submittedQuery ? "No titles found" : "Type a title or actor name"}</EmptyTitle>
            <EmptyText>Use the remote keyboard, then press Enter to search.</EmptyText>
          </EmptyState>
        )}
      </GridWrap>
    </Root>
  );
}


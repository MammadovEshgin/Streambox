import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View
} from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { Genre, MediaType, getMovieGenres, getTvGenres } from "../../api/tmdb";

/* ------------------------------------------------------------------ */
/*  Styled Components                                                 */
/* ------------------------------------------------------------------ */

const AnimatedBackdrop = styled(Animated.View)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.7);
  justify-content: flex-end;
`;

const Sheet = styled(Animated.View)`
  background-color: ${({ theme }) => theme.colors.surface};
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  max-height: 85%;
  padding-bottom: 34px;
`;

const Handle = styled.View`
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.border};
  align-self: center;
  margin-top: 12px;
  margin-bottom: 8px;
`;

const SheetHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const SheetTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 700;
`;

const ResetButton = styled(Pressable)`
  padding: 6px 14px;
  border-radius: 8px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const ResetText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  font-weight: 600;
`;

const Section = styled.View`
  padding: 20px 20px 0;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 14px;
`;

const ChipGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
`;

const Chip = styled(Pressable)<{ $active: boolean }>`
  padding: 8px 16px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.border};
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary + "20" : "transparent"};
`;

const ChipText = styled.Text<{ $active: boolean }>`
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? "600" : "400")};
`;

/* Slider-like year / rating row */
const RangeRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;

const RangeInput = styled.TextInput`
  flex: 1;
  height: 44px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
  text-align: center;
  padding: 0 12px;
`;

const RangeDash = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 16px;
`;

const RatingRow = styled.View`
  flex-direction: row;
  gap: 8px;
`;

const RatingChip = styled(Pressable)<{ $active: boolean }>`
  flex: 1;
  height: 42px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.border};
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary + "20" : "transparent"};
  align-items: center;
  justify-content: center;
  flex-direction: row;
  gap: 4px;
`;

const RatingChipText = styled.Text<{ $active: boolean }>`
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? "600" : "400")};
`;

const SortRow = styled.View`
  gap: 8px;
`;

const SortOption = styled(Pressable)<{ $active: boolean }>`
  height: 46px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.border};
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary + "20" : "transparent"};
  flex-direction: row;
  align-items: center;
  padding: 0 16px;
`;

const SortOptionText = styled.Text<{ $active: boolean }>`
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textPrimary};
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? "600" : "400")};
  margin-left: 10px;
`;

const ApplyButton = styled(Pressable)`
  margin: 24px 20px 0;
  height: 52px;
  border-radius: 3px;
  background-color: ${({ theme }) => theme.colors.primary};
  align-items: center;
  justify-content: center;
`;

const ApplyButtonText = styled.Text`
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
`;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type SortByOption = "popularity.desc" | "vote_average.desc" | "release_date.desc" | "vote_count.desc";

export type FilterState = {
  mediaType: MediaType;
  genreIds: number[];
  yearFrom: string;
  yearTo: string;
  ratingMin: number | null;
  sortBy: SortByOption;
};

export const DEFAULT_FILTERS: FilterState = {
  mediaType: "movie",
  genreIds: [],
  yearFrom: "",
  yearTo: "",
  ratingMin: null,
  sortBy: "popularity.desc"
};

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.genreIds.length > 0 ||
    filters.yearFrom !== "" ||
    filters.yearTo !== "" ||
    filters.ratingMin !== null ||
    filters.sortBy !== "popularity.desc"
  );
}

type FilterModalProps = {
  visible: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (filters: FilterState) => void;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const RATING_OPTIONS = [
  { label: "7+", value: 7 },
  { label: "8+", value: 8 },
  { label: "9+", value: 9 }
];

const SORT_OPTIONS: { label: string; value: SortByOption; icon: keyof typeof Feather.glyphMap }[] = [
  { label: "Most Popular", value: "popularity.desc", icon: "trending-up" },
  { label: "Highest Rated", value: "vote_average.desc", icon: "star" },
  { label: "Newest First", value: "release_date.desc", icon: "calendar" },
  { label: "Most Voted", value: "vote_count.desc", icon: "thumbs-up" }
];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function FilterModal({ visible, onClose, filters, onApply }: FilterModalProps) {
  const currentTheme = useTheme();
  const [local, setLocal] = useState<FilterState>(filters);
  const [genres, setGenres] = useState<Genre[]>([]);

  // Sync local state when modal opens
  useEffect(() => {
    if (visible) {
      setLocal(filters);
    }
  }, [visible, filters]);

  // Load genres based on media type
  useEffect(() => {
    if (!visible) return;

    (async () => {
      try {
        const list =
          local.mediaType === "movie" ? await getMovieGenres() : await getTvGenres();
        setGenres(list);
      } catch {
        setGenres([]);
      }
    })();
  }, [visible, local.mediaType]);

  const toggleGenre = useCallback((id: number) => {
    setLocal((prev) => ({
      ...prev,
      genreIds: prev.genreIds.includes(id)
        ? prev.genreIds.filter((g) => g !== id)
        : [...prev.genreIds, id]
    }));
  }, []);

  const handleReset = useCallback(() => {
    setLocal(DEFAULT_FILTERS);
  }, []);

  const handleApply = useCallback(() => {
    onApply(local);
    onClose();
  }, [local, onApply, onClose]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <AnimatedBackdrop entering={FadeIn.duration(250)} exiting={FadeOut.duration(200)}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Sheet
          entering={SlideInDown.duration(350).easing(Easing.out(Easing.cubic))}
          exiting={SlideOutDown.duration(280).easing(Easing.in(Easing.cubic))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => false}
        >
          <Handle />
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <ResetButton onPress={handleReset}>
              <ResetText>Reset</ResetText>
            </ResetButton>
          </SheetHeader>

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            {/* Media Type */}
            <Section>
              <SectionTitle>Type</SectionTitle>
              <ChipGrid>
                <Chip
                  $active={local.mediaType === "movie"}
                  onPress={() => setLocal((p) => ({ ...p, mediaType: "movie", genreIds: [] }))}
                >
                  <ChipText $active={local.mediaType === "movie"}>Movies</ChipText>
                </Chip>
                <Chip
                  $active={local.mediaType === "tv"}
                  onPress={() => setLocal((p) => ({ ...p, mediaType: "tv", genreIds: [] }))}
                >
                  <ChipText $active={local.mediaType === "tv"}>TV Series</ChipText>
                </Chip>
              </ChipGrid>
            </Section>

            {/* Genres */}
            <Section>
              <SectionTitle>Genres</SectionTitle>
              <ChipGrid>
                {genres.map((genre) => {
                  const active = local.genreIds.includes(genre.id);
                  return (
                    <Chip key={genre.id} $active={active} onPress={() => toggleGenre(genre.id)}>
                      <ChipText $active={active}>{genre.name}</ChipText>
                    </Chip>
                  );
                })}
              </ChipGrid>
            </Section>

            {/* Year Range */}
            <Section>
              <SectionTitle>Release Year</SectionTitle>
              <RangeRow>
                <RangeInput
                  value={local.yearFrom}
                  onChangeText={(v: string) =>
                    setLocal((p) => ({ ...p, yearFrom: v.replace(/[^0-9]/g, "").slice(0, 4) }))
                  }
                  placeholder="From"
                  placeholderTextColor={currentTheme.colors.textSecondary}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <RangeDash>—</RangeDash>
                <RangeInput
                  value={local.yearTo}
                  onChangeText={(v: string) =>
                    setLocal((p) => ({ ...p, yearTo: v.replace(/[^0-9]/g, "").slice(0, 4) }))
                  }
                  placeholder="To"
                  placeholderTextColor={currentTheme.colors.textSecondary}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </RangeRow>
            </Section>

            {/* Rating */}
            <Section>
              <SectionTitle>Minimum Rating</SectionTitle>
              <RatingRow>
                {RATING_OPTIONS.map((opt) => {
                  const active = local.ratingMin === opt.value;
                  return (
                    <RatingChip
                      key={opt.value}
                      $active={active}
                      onPress={() =>
                        setLocal((p) => ({
                          ...p,
                          ratingMin: p.ratingMin === opt.value ? null : opt.value
                        }))
                      }
                    >
                      <Feather
                        name="star"
                        size={14}
                        color={
                          active ? currentTheme.colors.primary : currentTheme.colors.textSecondary
                        }
                      />
                      <RatingChipText $active={active}>{opt.label}</RatingChipText>
                    </RatingChip>
                  );
                })}
              </RatingRow>
            </Section>

            {/* Sort By */}
            <Section>
              <SectionTitle>Sort By</SectionTitle>
              <SortRow>
                {SORT_OPTIONS.map((opt) => {
                  const active = local.sortBy === opt.value;
                  return (
                    <SortOption
                      key={opt.value}
                      $active={active}
                      onPress={() => setLocal((p) => ({ ...p, sortBy: opt.value }))}
                    >
                      <Feather
                        name={opt.icon}
                        size={16}
                        color={
                          active ? currentTheme.colors.primary : currentTheme.colors.textSecondary
                        }
                      />
                      <SortOptionText $active={active}>{opt.label}</SortOptionText>
                      {active && (
                        <View style={{ marginLeft: "auto" }}>
                          <Feather name="check" size={16} color={currentTheme.colors.primary} />
                        </View>
                      )}
                    </SortOption>
                  );
                })}
              </SortRow>
            </Section>
          </ScrollView>

          <ApplyButton onPress={handleApply}>
            <ApplyButtonText>Apply Filters</ApplyButtonText>
          </ApplyButton>
        </Sheet>
      </AnimatedBackdrop>
    </Modal>
  );
}

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import {
  GENRE_ID_MAP,
  MediaItem,
  getMovieLogos,
  getSeriesLogos,
  getTmdbImageUrl,
} from "../../api/tmdb";
import { AppTheme } from "../../theme/Theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SLIDE_WIDTH = SCREEN_WIDTH - 32;
const SLIDE_HEIGHT = 300;
const AUTO_ADVANCE_MS = 5000;
const IDLE_RESUME_MS = 8000;

type SpotlightCarouselProps = {
  items: MediaItem[];
  onPressItem: (item: MediaItem) => void;
};

const CarouselRoot = styled.View`
  margin-bottom: 22px;
`;

const SlideContainer = styled.View`
  width: ${SLIDE_WIDTH}px;
  height: ${SLIDE_HEIGHT}px;
  border-radius: 20px;
  overflow: hidden;
  background-color: ${({ theme }: { theme: AppTheme }) => theme.colors.surface};
`;

const ContentOverlay = styled.View`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px;
`;

const LogoImage = styled.Image`
  width: 180px;
  height: 48px;
  margin-bottom: 8px;
`;

const TitleText = styled.Text`
  color: ${({ theme }: { theme: AppTheme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 26px;
  letter-spacing: -0.8px;
  margin-bottom: 8px;
`;

const MetaRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 8px;
`;

const MetaText = styled.Text`
  color: ${({ theme }: { theme: AppTheme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 14px;
`;

const DescriptionText = styled.Text`
  color: ${({ theme }: { theme: AppTheme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  line-height: 18px;
  margin-bottom: 8px;
`;

const ChipRow = styled.View`
  flex-direction: row;
  gap: 6px;
`;

const GenreChip = styled.View`
  background-color: ${({ theme }: { theme: AppTheme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }: { theme: AppTheme }) => theme.colors.border};
  border-radius: ${({ theme }: { theme: AppTheme }) => theme.radius.sm}px;
  padding: 3px 8px;
`;

const ChipText = styled.Text`
  color: ${({ theme }: { theme: AppTheme }) => theme.colors.textPrimary};
  font-family: Outfit_500Medium;
  font-size: 11px;
  letter-spacing: 0.2px;
`;

const DotRow = styled.View`
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin-top: 12px;
  gap: 6px;
`;

function Slide({
  item,
  logoPath,
  scrollX,
  index,
  onPress,
}: {
  item: MediaItem;
  logoPath: string | null;
  scrollX: { value: number };
  index: number;
  onPress: () => void;
}) {
  const theme = useTheme() as AppTheme;
  const backdropUri = getTmdbImageUrl(item.backdropPath ?? item.posterPath, "w780");

  const parallaxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (scrollX.value - index * SLIDE_WIDTH) * 0.3 }],
  }));

  const genres = (item.genreIds ?? [])
    .slice(0, 2)
    .map((id) => GENRE_ID_MAP[id])
    .filter(Boolean);

  const logoUri = logoPath ? getTmdbImageUrl(logoPath, "w300") : null;

  return (
    <Pressable onPress={onPress}>
      <SlideContainer>
        {backdropUri ? (
          <Animated.Image
            source={{ uri: backdropUri }}
            style={[
              { position: "absolute", top: 0, left: -40, right: -40, bottom: 0, width: SLIDE_WIDTH + 80 },
              parallaxStyle,
            ]}
            resizeMode="cover"
          />
        ) : null}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.4)", theme.colors.background]}
          locations={[0.2, 0.5, 1]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <ContentOverlay>
          {logoUri ? (
            <LogoImage source={{ uri: logoUri }} resizeMode="contain" />
          ) : (
            <TitleText numberOfLines={2}>{item.title}</TitleText>
          )}

          <MetaRow>
            {typeof item.id !== "string" && !item.imdbId?.startsWith("az-") && (
              <>
                <Feather name="star" size={14} color="#FFD700" />
                <MetaText> {item.rating.toFixed(1)}  •  </MetaText>
              </>
            )}
            <MetaText>{item.year}</MetaText>
          </MetaRow>

          <DescriptionText numberOfLines={2}>{item.overview}</DescriptionText>

          {genres.length > 0 ? (
            <ChipRow>
              {genres.map((g) => (
                <GenreChip key={g}>
                  <ChipText>{g}</ChipText>
                </GenreChip>
              ))}
            </ChipRow>
          ) : null}
        </ContentOverlay>
      </SlideContainer>
    </Pressable>
  );
}

/**
 * Infinite-loop carousel: data is tripled [... items, ... items, ... items]
 * so the list starts at the middle copy. When the user scrolls past the end
 * or before the start of the middle copy we silently jump back, giving the
 * illusion of an endless loop with no rewind.
 */
export function SpotlightCarousel({
  items,
  onPressItem,
}: SpotlightCarouselProps) {
  const theme = useTheme() as AppTheme;
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useSharedValue(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [logos, setLogos] = useState<Record<number | string, string | null>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInteractedRef = useRef(false);
  const count = items.length;

  // Triple the data for infinite illusion
  const loopedData = useMemo(
    () => [...items, ...items, ...items],
    [items]
  );
  const middleStart = count; // index where the middle copy begins

  // Fetch logos on mount
  useEffect(() => {
    Promise.all(
      items
        .filter((item) => typeof item.id === "number")
        .map(async (item) => {
          const fn = item.mediaType === "movie" ? getMovieLogos : getSeriesLogos;
          const path = await fn(Number(item.id));
          return [item.id, path] as const;
        })
    ).then((results) => {
      const map: Record<number | string, string | null> = {};
      for (const [id, path] of results) map[id] = path;
      setLogos(map);
    });
  }, [items]);

  // Start at middle copy on mount
  const initialOffset = middleStart * SLIDE_WIDTH;

  // Silent jump to keep the user inside the middle copy
  const reCenter = useCallback(
    (rawIndex: number) => {
      if (count === 0) return;
      const realIndex = rawIndex % count;
      const middleIndex = middleStart + realIndex;
      if (rawIndex !== middleIndex) {
        flatListRef.current?.scrollToOffset({ offset: middleIndex * SLIDE_WIDTH, animated: false });
      }
      setActiveIndex(realIndex);
    },
    [count, middleStart]
  );

  // Auto-advance timer — always goes forward by one slide
  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (count <= 1) return;
      const nextReal = (activeIndex + 1) % count;
      const nextLooped = middleStart + nextReal;
      flatListRef.current?.scrollToIndex({ index: nextLooped, animated: true });
      // After scroll animation settles, re-center silently
      setTimeout(() => reCenter(nextLooped), 400);
      userInteractedRef.current = false;
    }, userInteractedRef.current ? IDLE_RESUME_MS : AUTO_ADVANCE_MS);
  }, [activeIndex, count, middleStart, reCenter]);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startTimer]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollX.value = e.nativeEvent.contentOffset.x;
    },
    [scrollX]
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const rawIndex = Math.round(e.nativeEvent.contentOffset.x / SLIDE_WIDTH);
      userInteractedRef.current = true;
      reCenter(rawIndex);
    },
    [reCenter]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: MediaItem; index: number }) => (
      <Slide
        item={item}
        logoPath={logos[item.id] ?? null}
        scrollX={scrollX}
        index={index}
        onPress={() => onPressItem(item)}
      />
    ),
    [logos, scrollX, onPressItem]
  );

  if (items.length === 0) return null;

  return (
    <CarouselRoot>
      <FlatList
        ref={flatListRef}
        data={loopedData}
        horizontal
        pagingEnabled
        snapToInterval={SLIDE_WIDTH}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, idx) => `spotlight-${idx}`}
        renderItem={renderItem}
        onScroll={onScroll}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        contentOffset={{ x: initialOffset, y: 0 }}
        getItemLayout={(_, index) => ({
          length: SLIDE_WIDTH,
          offset: SLIDE_WIDTH * index,
          index,
        })}
      />
      <DotRow>
        {items.map((item, i) => (
          <AnimatedDot key={item.id} isActive={i === activeIndex} theme={theme} />
        ))}
      </DotRow>
    </CarouselRoot>
  );
}

function AnimatedDot({ isActive, theme }: { isActive: boolean; theme: AppTheme }) {
  const width = useSharedValue(isActive ? 16 : 6);
  const bgColor = isActive ? theme.colors.primary : theme.colors.border;

  useEffect(() => {
    width.value = withTiming(isActive ? 16 : 6, { duration: 300, easing: Easing.out(Easing.ease) });
  }, [isActive, width]);

  const style = useAnimatedStyle(() => ({
    width: width.value,
    height: 6,
    borderRadius: 3,
    backgroundColor: bgColor,
  }));

  return <Animated.View style={style} />;
}

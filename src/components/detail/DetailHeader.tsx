import { Feather } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";
import { CachedRemoteImage } from "../common/CachedRemoteImage";

const HeaderRoot = styled.View`
  position: relative;
  height: 380px;
  border-bottom-left-radius: 28px;
  border-bottom-right-radius: 28px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const Backdrop = styled(CachedRemoteImage)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

const Darken = styled.View`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(11, 11, 14, 0.18);
`;

const FadeGradient = styled(LinearGradient)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

const BackButton = styled(Pressable)<{ $topOffset: number }>`
  position: absolute;
  top: ${({ $topOffset }) => $topOffset}px;
  left: 16px;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  align-items: center;
  justify-content: center;
`;

const ActionButton = styled(Pressable)<{ $topOffset: number }>`
  position: absolute;
  top: ${({ $topOffset }) => $topOffset}px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  align-items: center;
  justify-content: center;
`;

const ActionButtonBody = styled(Animated.View)`
  width: 100%;
  height: 100%;
  border-radius: 999px;
  align-items: center;
  justify-content: center;
`;

const TrailerButton = styled(Pressable)<{ $topOffset: number }>`
  position: absolute;
  top: ${({ $topOffset }) => $topOffset}px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  align-items: center;
  justify-content: center;
`;

type DetailHeaderProps = {
  posterPath: string | null;
  backdropPath: string | null;
  onBack: () => void;
  isInWatchlist?: boolean;
  onToggleWatchlist?: () => void;
  showWatchlistAction?: boolean;
  onTrailer?: () => void;
  showTrailerAction?: boolean;
  isLiked?: boolean;
  onToggleLike?: () => void;
  showLikeAction?: boolean;
};

export function DetailHeader({
  posterPath,
  backdropPath,
  onBack,
  isInWatchlist = false,
  onToggleWatchlist,
  showWatchlistAction = true,
  onTrailer,
  showTrailerAction = false,
  isLiked = false,
  onToggleLike,
  showLikeAction = true
}: DetailHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isHighResLoaded, setIsHighResLoaded] = useState(false);
  const watchlistProgress = useSharedValue(isInWatchlist ? 1 : 0);
  const loveProgress = useSharedValue(isLiked ? 1 : 0);

  const getImageUrl = (path: string | null, size: any) => {
    if (!path) return null;
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return getTmdbImageUrl(path, size);
  };

  const lowResUri = getImageUrl(backdropPath ?? posterPath, "w185");
  const highResUri = getImageUrl(backdropPath ?? posterPath, "w780");

  useEffect(() => {
    watchlistProgress.value = withTiming(isInWatchlist ? 1 : 0, {
      duration: 230,
      easing: Easing.out(Easing.cubic)
    });
  }, [isInWatchlist, watchlistProgress]);

  useEffect(() => {
    loveProgress.value = withTiming(isLiked ? 1 : 0, {
      duration: 230,
      easing: Easing.out(Easing.cubic)
    });
  }, [isLiked, loveProgress]);

  const watchlistOutlineStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      opacity: 1 - watchlistProgress.value
    };
  });

  const watchlistFilledStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      opacity: watchlistProgress.value
    };
  });

  const loveOutlineStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      opacity: 1 - loveProgress.value
    };
  });

  const loveFilledStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      opacity: loveProgress.value
    };
  });

  const watchlistTopOffset = insets.top + 8;
  const likeTopOffset = showWatchlistAction ? watchlistTopOffset + 50 : watchlistTopOffset;
  const trailerTopOffset = (showLikeAction ? likeTopOffset + 50 : (showWatchlistAction ? watchlistTopOffset + 50 : watchlistTopOffset));

  return (
    <HeaderRoot>
      {lowResUri ? <Backdrop uri={lowResUri} contentFit="cover" blurRadius={2} /> : null}
      {highResUri ? (
        <Backdrop
          uri={highResUri}
          contentFit="cover"
          onLoad={() => setIsHighResLoaded(true)}
          style={{ opacity: isHighResLoaded ? 1 : 0 }}
        />
      ) : null}
      <Darken />
      <FadeGradient
        colors={["rgba(11,11,14,0.00)", "rgba(11,11,14,0.40)", "rgba(11,11,14,0.92)", theme.colors.background]}
        locations={[0, 0.45, 0.82, 1]}
      />
      <BackButton onPress={onBack} $topOffset={insets.top + 8}>
        <Feather name="arrow-left" size={18} color={theme.colors.textPrimary} />
      </BackButton>

      {showWatchlistAction ? (
        <ActionButton onPress={onToggleWatchlist} $topOffset={watchlistTopOffset}>
          <ActionButtonBody>
            <Animated.View style={watchlistOutlineStyle}>
              <MaterialCommunityIcons name="bookmark-outline" size={22} color={theme.colors.textPrimary} />
            </Animated.View>
            <Animated.View style={watchlistFilledStyle}>
              <MaterialCommunityIcons name="bookmark" size={22} color={theme.colors.primary} />
            </Animated.View>
          </ActionButtonBody>
        </ActionButton>
      ) : null}

      {showLikeAction ? (
        <ActionButton onPress={onToggleLike} $topOffset={likeTopOffset}>
          <ActionButtonBody>
            <Animated.View style={loveOutlineStyle}>
              <MaterialCommunityIcons name="heart-outline" size={22} color={theme.colors.textPrimary} />
            </Animated.View>
            <Animated.View style={loveFilledStyle}>
              <MaterialCommunityIcons name="heart" size={22} color={theme.colors.primary} />
            </Animated.View>
          </ActionButtonBody>
        </ActionButton>
      ) : null}

      {showTrailerAction && onTrailer ? (
        <TrailerButton onPress={onTrailer} $topOffset={trailerTopOffset}>
          <MaterialCommunityIcons name="movie-open-outline" size={22} color={theme.colors.textPrimary} />
        </TrailerButton>
      ) : null}
    </HeaderRoot>
  );
}

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

const HeaderRoot = styled.View`
  position: relative;
  height: 356px;
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const Backdrop = styled.Image`
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
  background-color: rgba(0, 0, 0, 0.22);
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
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background-color: rgba(0, 0, 0, 0.42);
  align-items: center;
  justify-content: center;
`;

const ActionButton = styled(Pressable)<{ $topOffset: number }>`
  position: absolute;
  top: ${({ $topOffset }) => $topOffset}px;
  right: 16px;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
`;

const ActionButtonBody = styled(Animated.View)`
  width: 100%;
  height: 100%;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
`;

const TrailerButton = styled(Pressable)<{ $topOffset: number }>`
  position: absolute;
  top: ${({ $topOffset }) => $topOffset}px;
  right: 16px;
  width: 42px;
  height: 42px;
  border-radius: 12px;
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
      {lowResUri ? <Backdrop source={{ uri: lowResUri }} resizeMode="cover" blurRadius={2} /> : null}
      {highResUri ? (
        <Backdrop
          source={{ uri: highResUri }}
          resizeMode="cover"
          onLoadEnd={() => setIsHighResLoaded(true)}
          style={{ opacity: isHighResLoaded ? 1 : 0 }}
        />
      ) : null}
      <Darken />
      <FadeGradient
        colors={["rgba(0,0,0,0.00)", "rgba(0,0,0,0.55)", "#000000"]}
        locations={[0, 0.58, 1]}
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
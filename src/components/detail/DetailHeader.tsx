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
  padding-left: 3px;
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
};

export function DetailHeader({
  posterPath,
  backdropPath,
  onBack,
  isInWatchlist = false,
  onToggleWatchlist,
  showWatchlistAction = true,
  onTrailer,
  showTrailerAction = false
}: DetailHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isHighResLoaded, setIsHighResLoaded] = useState(false);
  const watchlistProgress = useSharedValue(isInWatchlist ? 1 : 0);
  const lowResUri = getTmdbImageUrl(backdropPath ?? posterPath, "w185");
  const highResUri = getTmdbImageUrl(backdropPath ?? posterPath, "w780");

  useEffect(() => {
    watchlistProgress.value = withTiming(isInWatchlist ? 1 : 0, {
      duration: 230,
      easing: Easing.out(Easing.cubic)
    });
  }, [isInWatchlist, watchlistProgress]);

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

  const watchlistTopOffset = insets.top + 8;
  const trailerTopOffset = watchlistTopOffset + 50;

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
      {showTrailerAction && onTrailer ? (
        <TrailerButton onPress={onTrailer} $topOffset={trailerTopOffset}>
          <MaterialCommunityIcons name="movie-open-outline" size={22} color={theme.colors.textPrimary} />
        </TrailerButton>
      ) : null}
    </HeaderRoot>
  );
}
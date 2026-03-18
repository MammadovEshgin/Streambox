import React from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, View } from "react-native";
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import styled, { useTheme } from "styled-components/native";

import { SeriesEpisode } from "../../api/tmdb";

const EpisodeCard = styled.View`
  height: 112px;
  border-radius: 10px;
  padding: 0;
  background-color: rgba(255, 255, 255, 0.04);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.07);
  overflow: hidden;
`;

const EpisodeWatchButton = styled(Pressable)`
  flex: 1;
`;

const EpisodeRow = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: stretch;
`;

const EpisodeStillWrap = styled.View`
  width: 136px;
  align-self: stretch;
  background-color: rgba(255, 255, 255, 0.05);
  border-right-width: 1px;
  border-right-color: rgba(255, 255, 255, 0.08);
`;

const EpisodeStill = styled.Image`
  width: 100%;
  height: 100%;
`;

const EpisodeStillPlaceholder = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EpisodeStillPlaceholderText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 9px;
  letter-spacing: 0.25px;
  text-transform: uppercase;
`;

const EpisodeContent = styled.View`
  flex: 1;
  padding: 10px 12px 10px 12px;
  justify-content: flex-start;
`;

const EpisodeHead = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const EpisodeName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 16px;
  font-weight: 700;
  letter-spacing: -0.1px;
  flex: 1;
  margin-right: 8px;
`;

const EpisodeMeta = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 13px;
`;

const EpisodeOverview = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 16px;
`;

const StampImage = styled.Image`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  opacity: 0.85;
`;

const SwipeBackground = styled(Animated.View)`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  border-radius: 10px;
  flex-direction: row;
  align-items: center;
  padding-left: 20px;
`;

function formatEpisodeMeta(item: SeriesEpisode): string {
  const segments: string[] = [];
  if (item.runtimeMinutes && item.runtimeMinutes > 0) {
    segments.push(`${item.runtimeMinutes}m`);
  }
  if (item.airDate) {
    const year = item.airDate.split("-")[0];
    if (year) {
      segments.push(year);
    }
  }
  return segments.join(" | ");
}

interface SwipeableEpisodeCardProps {
  episode: SeriesEpisode;
  stillUri: string | null;
  isWatched: boolean;
  onToggleWatched: () => void;
  onPress: () => void;
}

export function SwipeableEpisodeCard({ episode, stillUri, isWatched, onToggleWatched, onPress }: SwipeableEpisodeCardProps) {
  const currentTheme = useTheme();
  const translateX = useSharedValue(0);
  const isSwiping = useSharedValue(false);

  const SWIPE_THRESHOLD = 60;
  const MAX_SWIPE = 100;

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onStart(() => {
      isSwiping.value = true;
    })
    .onUpdate((event) => {
      translateX.value = Math.max(0, Math.min(event.translationX, MAX_SWIPE));
    })
    .onEnd(() => {
      if (translateX.value > SWIPE_THRESHOLD) {
        runOnJS(onToggleWatched)();
      }

      translateX.value = withSpring(0, {
        stiffness: 200,
        damping: 20
      });
      isSwiping.value = false;
    });

  const rStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }]
    };
  });

  const rBackgroundStyle = useAnimatedStyle(() => {
    const opacity = translateX.value / SWIPE_THRESHOLD;
    const color = interpolateColor(
      Math.min(1, opacity),
      [0, 1],
      ["transparent", currentTheme.colors.primarySoftStrong || "rgba(255, 77, 0, 0.2)"]
    );
    return {
      backgroundColor: color
    };
  });

  const rIconStyle = useAnimatedStyle(() => {
    const scale = Math.max(0, Math.min(1, translateX.value / SWIPE_THRESHOLD));
    return {
      transform: [{ scale }]
    };
  });

  return (
    <View style={{ marginBottom: 10, overflow: "visible" }}>
      <SwipeBackground style={rBackgroundStyle}>
        <Animated.View style={rIconStyle}>
          <MaterialCommunityIcons
            name={isWatched ? "eye-off-outline" : "movie-open-outline"}
            size={32}
            color={currentTheme.colors.primary}
          />
        </Animated.View>
      </SwipeBackground>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[rStyle]}>
          <EpisodeCard>
            <EpisodeWatchButton
              style={{ height: 112, borderRadius: 10, backgroundColor: "transparent" }}
              onPress={onPress}
            >
              <EpisodeRow>
                <EpisodeStillWrap>
                  {stillUri ? (
                    <EpisodeStill source={{ uri: stillUri }} resizeMode="cover" />
                  ) : (
                    <EpisodeStillPlaceholder>
                      <EpisodeStillPlaceholderText>No Still</EpisodeStillPlaceholderText>
                    </EpisodeStillPlaceholder>
                  )}
                  {isWatched && (
                    <StampImage
                      source={require("../../assets/watched_stamp.png")}
                      resizeMode="cover"
                    />
                  )}
                </EpisodeStillWrap>
                <EpisodeContent>
                  <EpisodeHead>
                    <EpisodeName numberOfLines={1}>
                      E{episode.episodeNumber} | {episode.name}
                    </EpisodeName>
                    <EpisodeMeta>{formatEpisodeMeta(episode)}</EpisodeMeta>
                  </EpisodeHead>
                  {episode.overview ? (
                    <EpisodeOverview numberOfLines={4}>{episode.overview}</EpisodeOverview>
                  ) : null}
                </EpisodeContent>
              </EpisodeRow>
            </EpisodeWatchButton>
          </EpisodeCard>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

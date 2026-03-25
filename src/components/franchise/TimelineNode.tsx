import { memo, useCallback, useEffect, useState } from "react";
import { Dimensions } from "react-native";
import styled, { useTheme } from "styled-components/native";
import { Feather } from "@expo/vector-icons";

import type { FranchiseEntry } from "../../api/franchises";
import { resolveFranchiseImageUriBlocking } from "../../services/franchisePosterCache";

const SCREEN_WIDTH = Dimensions.get("window").width;

// Poster dimensions
const POSTER_WIDTH = 108;
const POSTER_HEIGHT = 160;

// The full node spans most of the screen width
const NODE_FULL_WIDTH = SCREEN_WIDTH - 72;

// Gap between poster and info panel
const INFO_GAP = 14;

// Info panel takes remaining space
const INFO_WIDTH = NODE_FULL_WIDTH - POSTER_WIDTH - INFO_GAP;

// ── Styled Components ───────────────────────────────────────────────────

const NodeRow = styled.View<{ $isLeft: boolean }>`
  width: ${NODE_FULL_WIDTH}px;
  flex-direction: ${({ $isLeft }) => ($isLeft ? "row" : "row-reverse")};
  align-items: center;
  gap: ${INFO_GAP}px;
`;

const PosterPressable = styled.Pressable`
  width: ${POSTER_WIDTH}px;
  height: ${POSTER_HEIGHT}px;
  border-radius: 11px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const PosterImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const NoPoster = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const NoPosterText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const WatchedOverlay = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  align-items: center;
  justify-content: center;
`;

const CheckBadge = styled.View<{ $color: string }>`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background-color: ${({ $color }) => $color};
  align-items: center;
  justify-content: center;
`;

const UpcomingPill = styled.View`
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  border-radius: 5px;
  background-color: rgba(255, 255, 255, 0.15);
`;

const UpcomingText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_500Medium;
  font-size: 8px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
`;

// ── Info Panel ──────────────────────────────────────────────────────────

const InfoPanel = styled.View<{ $isLeft: boolean }>`
  width: ${INFO_WIDTH}px;
  justify-content: center;
`;

const OrderBadge = styled.View<{ $color: string; $isLeft: boolean }>`
  align-self: ${({ $isLeft }) => ($isLeft ? "flex-start" : "flex-end")};
  padding: 2px 8px;
  border-radius: 6px;
  background-color: ${({ $color }) => `${$color}18`};
  margin-bottom: 6px;
`;

const OrderBadgeText = styled.Text<{ $color: string }>`
  color: ${({ $color }) => $color};
  font-family: Outfit_600SemiBold;
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
`;

const EntryTitle = styled.Text<{ $isLeft: boolean }>`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
  line-height: 18px;
  letter-spacing: -0.15px;
  text-align: ${({ $isLeft }) => ($isLeft ? "left" : "right")};
`;

const MetaRow = styled.View<{ $isLeft: boolean }>`
  flex-direction: row;
  align-items: center;
  margin-top: 8px;
  justify-content: ${({ $isLeft }) => ($isLeft ? "flex-start" : "flex-end")};
`;

const MetaDot = styled.View`
  width: 3px;
  height: 3px;
  border-radius: 1.5px;
  background-color: rgba(255, 255, 255, 0.2);
  margin: 0 6px;
`;

const MetaText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 11px;
  line-height: 14px;
  letter-spacing: 0.1px;
`;

const DescriptionText = styled.Text<{ $isLeft: boolean }>`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 11px;
  line-height: 15px;
  letter-spacing: 0.05px;
  margin-top: 4px;
  text-align: ${({ $isLeft }) => ($isLeft ? "left" : "right")};
  font-style: italic;
  opacity: 0.7;
`;

// ── Component ───────────────────────────────────────────────────────────

type TimelineNodeProps = {
  entry: FranchiseEntry;
  isLeft: boolean;
  isWatched: boolean;
  onPress: (entry: FranchiseEntry) => void;
  onLongPress: (entry: FranchiseEntry) => void;
};

function TimelineNodeComponent({
  entry,
  isLeft,
  isWatched,
  onPress,
  onLongPress,
}: TimelineNodeProps) {
  const theme = useTheme();
  const handlePress = useCallback(() => onPress(entry), [entry, onPress]);
  const handleLongPress = useCallback(() => onLongPress(entry), [entry, onLongPress]);
  const [posterUri, setPosterUri] = useState<string | null>(entry.cachedPosterUrl ?? entry.posterUrl ?? null);

  const yearText = entry.year ? String(entry.year) : null;
  let durationText: string | null = null;
  if (entry.mediaType === "tv") {
    durationText = entry.episodeCount ? `${entry.episodeCount} eps` : "Series";
  } else if (entry.runtimeMinutes) {
    const h = Math.floor(entry.runtimeMinutes / 60);
    const m = entry.runtimeMinutes % 60;
    durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const descriptionText = entry.tagline || entry.note || null;

  useEffect(() => {
    let active = true;
    const nextUri = entry.cachedPosterUrl ?? entry.posterUrl ?? null;
    setPosterUri(nextUri);

    if (!entry.posterUrl || entry.cachedPosterUrl) {
      return () => {
        active = false;
      };
    }

    void resolveFranchiseImageUriBlocking(entry.posterUrl)
      .then((resolvedUri) => {
        if (!active || !resolvedUri || resolvedUri === nextUri) {
          return;
        }
        setPosterUri(resolvedUri);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [entry.cachedPosterUrl, entry.posterUrl]);

  const handlePosterError = useCallback(() => {
    if (!entry.posterUrl) {
      return;
    }

    void resolveFranchiseImageUriBlocking(entry.posterUrl)
      .then((resolvedUri) => {
        if (!resolvedUri) {
          return;
        }
        setPosterUri(resolvedUri);
      })
      .catch(() => undefined);
  }, [entry.posterUrl]);

  return (
    <NodeRow $isLeft={isLeft}>
      {/* Poster */}
      <PosterPressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        style={({ pressed }) => [
          {
            opacity: pressed ? 0.8 : entry.isReleased ? 1 : 0.55,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        {posterUri ? (
          <PosterImage
            source={{ uri: posterUri }}
            resizeMode="cover"
            onError={handlePosterError}
          />
        ) : (
          <NoPoster>
            <NoPosterText>TBA</NoPosterText>
          </NoPoster>
        )}

        {!entry.isReleased && (
          <UpcomingPill>
            <UpcomingText>Soon</UpcomingText>
          </UpcomingPill>
        )}

        {isWatched && (
          <WatchedOverlay>
            <CheckBadge $color={theme.colors.primary}>
              <Feather name="check" size={14} color="#FFFFFF" />
            </CheckBadge>
          </WatchedOverlay>
        )}
      </PosterPressable>

      {/* Info Panel — sits beside the poster */}
      <InfoPanel $isLeft={isLeft}>
        <OrderBadge $color={theme.colors.primary} $isLeft={isLeft}>
          <OrderBadgeText $color={theme.colors.primary}>
            #{entry.watchOrder} {entry.mediaType === "tv" ? "Series" : "Film"}
          </OrderBadgeText>
        </OrderBadge>

        <EntryTitle $isLeft={isLeft} numberOfLines={2}>
          {entry.title}
        </EntryTitle>

        {descriptionText && (
          <DescriptionText $isLeft={isLeft} numberOfLines={3}>
            "{descriptionText}"
          </DescriptionText>
        )}
        
        <MetaRow $isLeft={isLeft}>
          {yearText && <MetaText>{yearText}</MetaText>}
          {yearText && durationText && <MetaDot />}
          {durationText && <MetaText>{durationText}</MetaText>}
        </MetaRow>
      </InfoPanel>
    </NodeRow>
  );
}

export const TimelineNode = memo(TimelineNodeComponent);

export { POSTER_WIDTH, POSTER_HEIGHT, NODE_FULL_WIDTH };

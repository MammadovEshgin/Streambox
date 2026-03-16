import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import styled, { useTheme } from "styled-components/native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";

import { personaCardImages } from "../../assets/images";
import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { useAppSettings } from "../../settings/AppSettingsContext";
import { withAlpha } from "../../theme/Theme";
import { StatsSection } from "./StatsSection";

/* ── Card shell ── */
const Card = styled.View`
  position: relative;
  overflow: hidden;
  border-radius: 5px;
  background-color: ${({ theme }) => withAlpha(theme.colors.surface, 0.98)};
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.1)};
`;

/* ── Image — centered, fully visible, no crop ── */
const ImageWrap = styled.View`
  width: 100%;
  align-items: center;
  padding: 24px 24px 0;
`;

const PersonaImage = styled.Image`
  width: 75%;
  height: 300px;
  border-radius: 5px;
`;

/* ── Fullscreen modal ── */
const FullscreenBackdrop = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.95);
  align-items: center;
  justify-content: center;
`;

const FullscreenImage = styled.Image`
  width: 90%;
  height: 90%;
`;

/* ── Divider between image and text ── */
const Divider = styled.View`
  height: 1px;
  margin: 0 20px;
  background-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.08)};
`;

/* ── Traits row ── */
const TraitsRow = styled.View`
  flex-direction: row;
  justify-content: center;
  gap: 8px;
  padding: 16px 20px 0;
`;

const TraitChip = styled.View`
  background-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.08)};
  border-radius: 3px;
  padding: 5px 10px;
`;

const TraitText = styled.Text`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: ${({ theme }) => withAlpha(theme.colors.primary, 0.6)};
`;

/* ── Body below traits ── */
const Body = styled.View`
  padding: 14px 20px 22px;
  align-items: center;
`;

const Motto = styled.Text`
  font-size: 13px;
  font-style: italic;
  line-height: 20px;
  text-align: center;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.5)};
`;

const Description = styled.Text`
  font-size: 12px;
  line-height: 19px;
  text-align: center;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.34)};
  margin-top: 10px;
`;

/* ── Locked state ── */
const LockedInner = styled.View`
  padding: 32px 20px;
  align-items: center;
`;

const LockIcon = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 24px;
  background-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.08)};
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.12)};
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
`;

const LockSymbol = styled.Text`
  font-size: 20px;
  color: ${({ theme }) => withAlpha(theme.colors.primary, 0.5)};
`;

const LockedTitle = styled.Text`
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.2px;
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
`;

const LockedSub = styled.Text`
  font-size: 12px;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.36)};
  text-align: center;
  margin-top: 6px;
  line-height: 18px;
`;

const ProgressWrap = styled.View`
  width: 100%;
  margin-top: 20px;
`;

const ProgressTrack = styled.View`
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.06)};
  overflow: hidden;
`;

const ProgressFill = styled.View<{ $pct: number }>`
  height: 4px;
  border-radius: 2px;
  width: ${({ $pct }) => $pct}%;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const ProgressLabel = styled.Text`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.3)};
  text-align: center;
  margin-top: 8px;
`;

type Props = {
  history: WatchHistoryEntry[];
  itemLabelPlural: string;
};

type PersonaId =
  | "thrillSeeker"
  | "dreamer"
  | "romantic"
  | "laughHunter"
  | "detective"
  | "cultureBuff"
  | "horrorFanatic"
  | "blockbusterFan"
  | "eclecticExplorer";

type Persona = {
  id: PersonaId;
  name: string;
  description: string;
  arcana: string;
  cardTitle: string;
  motto: string;
  traits: [string, string, string];
  accent: string;
};

const PERSONAS = {
  thrillSeeker: {
    id: "thrillSeeker",
    name: "The Thrill Seeker",
    description:
      "You chase momentum, danger, and sharp turns. Every watch needs motion, friction, and the feeling that something could snap at any second.",
    arcana: "Arcana I",
    cardTitle: "The Voltage Crown",
    motto: "Speed is your compass. Suspense is your oxygen.",
    traits: ["adrenaline", "tension", "impact"],
    accent: "#FF6A1A",
  },
  dreamer: {
    id: "dreamer",
    name: "The Dreamer",
    description:
      "You are drawn to impossible futures, mythic worlds, and stories that widen reality. You watch to leave the ordinary behind.",
    arcana: "Arcana II",
    cardTitle: "The Celestial Draft",
    motto: "You collect horizons that do not exist yet.",
    traits: ["wonder", "myth", "escape"],
    accent: "#FF944D",
  },
  romantic: {
    id: "romantic",
    name: "The Romantic",
    description:
      "You look for emotional gravity, longing, and the moments that stay tender after the credits. Connection matters more than spectacle.",
    arcana: "Arcana III",
    cardTitle: "The Ember Heart",
    motto: "You trust stories that bruise softly and linger long.",
    traits: ["feeling", "intimacy", "yearning"],
    accent: "#FF855C",
  },
  laughHunter: {
    id: "laughHunter",
    name: "The Laugh Hunter",
    description:
      "You favor rhythm, charm, and release. Even when the world is heavy, your taste leans toward wit, brightness, and well-timed relief.",
    arcana: "Arcana IV",
    cardTitle: "The Golden Jester",
    motto: "You know timing is a form of intelligence.",
    traits: ["wit", "light", "spark"],
    accent: "#F6A04D",
  },
  detective: {
    id: "detective",
    name: "The Detective",
    description:
      "You are patient with shadows and obsessed with the hidden pattern. Suspicion, clues, and moral gray zones are where your focus sharpens.",
    arcana: "Arcana V",
    cardTitle: "The Veiled Lens",
    motto: "You do not watch for answers. You watch for the missing piece.",
    traits: ["clues", "ambiguity", "precision"],
    accent: "#C96B21",
  },
  cultureBuff: {
    id: "cultureBuff",
    name: "The Culture Buff",
    description:
      "You treat film and series as memory vessels. Real lives, historical echoes, and lived detail hold your attention longer than spectacle alone.",
    arcana: "Arcana VI",
    cardTitle: "The Archive Flame",
    motto: "You watch to understand what time leaves behind.",
    traits: ["memory", "context", "insight"],
    accent: "#D97706",
  },
  horrorFanatic: {
    id: "horrorFanatic",
    name: "The Horror Fanatic",
    description:
      "You do not avoid dread - you study it. Fear, atmosphere, and the slow distortion of safety are part of what makes a story worth entering.",
    arcana: "Arcana VII",
    cardTitle: "The Midnight Oath",
    motto: "You know terror is just another way to feel fully awake.",
    traits: ["dread", "night", "ritual"],
    accent: "#8C4516",
  },
  blockbusterFan: {
    id: "blockbusterFan",
    name: "The Blockbuster Fan",
    description:
      "You trust scale when it is earned. Big emotion, broad appeal, and polished craft work for you when the experience still feels complete.",
    arcana: "Arcana VIII",
    cardTitle: "The Marquee Gold",
    motto: "When a story lands for everyone, you respect the engineering.",
    traits: ["spectacle", "crowd", "craft"],
    accent: "#FF8A3D",
  },
  eclecticExplorer: {
    id: "eclecticExplorer",
    name: "The Eclectic Explorer",
    description:
      "Your taste resists borders. You move between moods, eras, and genres freely, and that range is the signature rather than a lack of one.",
    arcana: "Arcana IX",
    cardTitle: "The Open Atlas",
    motto: "Variety is not drift - it is your method.",
    traits: ["range", "curiosity", "drift"],
    accent: "#FDBA74",
  },
} satisfies Record<PersonaId, Persona>;

const PERSONA_RULES: { genres: string[]; persona: Persona }[] = [
  { genres: ["Action", "Thriller"], persona: PERSONAS.thrillSeeker },
  { genres: ["Science Fiction", "Fantasy"], persona: PERSONAS.dreamer },
  { genres: ["Romance", "Drama"], persona: PERSONAS.romantic },
  { genres: ["Comedy"], persona: PERSONAS.laughHunter },
  { genres: ["Crime", "Mystery"], persona: PERSONAS.detective },
  { genres: ["Documentary", "History"], persona: PERSONAS.cultureBuff },
  { genres: ["Horror"], persona: PERSONAS.horrorFanatic },
];

function classifyPersona(history: WatchHistoryEntry[]): Persona {
  const genreCounts: Record<string, number> = {};
  let totalGenreHits = 0;

  // Tally all genres across history
  for (const entry of history) {
    for (const genre of entry.genres) {
      genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
      totalGenreHits++;
    }
  }

  if (totalGenreHits === 0) {
    return PERSONAS.eclecticExplorer;
  }

  // Find the highest counted genre overall
  let topGenre = "";
  let topCount = 0;
  for (const [genre, count] of Object.entries(genreCounts)) {
    if (count > topCount) {
      topCount = count;
      topGenre = genre;
    }
  }

  // Find a specific persona rule matching the absolute top genre
  for (const rule of PERSONA_RULES) {
    if (rule.genres.includes(topGenre)) {
      return rule.persona;
    }
  }

  // Fallback to average score check to assign blockbuster/eclectic
  const avgRating = history.reduce((sum, entry) => sum + entry.voteAverage, 0) / history.length;
  const popularGenres = ["Action", "Adventure", "Comedy", "Drama"];
  const hasPopularGenre = popularGenres.some((genre) => (genreCounts[genre] ?? 0) > 0);
  
  if (avgRating >= 7 && hasPopularGenre) {
    const topRatio = topCount / totalGenreHits;
    if (topRatio < 0.4) {
      return PERSONAS.blockbusterFan;
    }
  }

  return PERSONAS.eclecticExplorer;
}

export function ViewerPersona({ history, itemLabelPlural }: Props) {
  const threshold = 5;
  const isLocked = history.length < threshold;

  return (
    <StatsSection title="Your Persona Card" subtitle="A personality card based on your viewing habits.">
      {isLocked ? (
        <LockedPersonaCard
          progress={Math.min(100, (history.length / threshold) * 100)}
          count={history.length}
          threshold={threshold}
          itemLabelPlural={itemLabelPlural}
        />
      ) : (
        <PersonaCard persona={classifyPersona(history)} />
      )}
    </StatsSection>
  );
}

function LockedPersonaCard({
  progress,
  count,
  threshold,
  itemLabelPlural,
}: {
  progress: number;
  count: number;
  threshold: number;
  itemLabelPlural: string;
}) {
  return (
    <Card>
      <LockedInner>
        <LockIcon>
          <LockSymbol>?</LockSymbol>
        </LockIcon>
        <LockedTitle>Persona Locked</LockedTitle>
        <LockedSub>
          Watch {threshold - count} more {itemLabelPlural} to reveal{"\n"}your viewer identity.
        </LockedSub>
        <ProgressWrap>
          <ProgressTrack>
            <ProgressFill $pct={progress} />
          </ProgressTrack>
          <ProgressLabel>{count} / {threshold}</ProgressLabel>
        </ProgressWrap>
      </LockedInner>
    </Card>
  );
}

function ShareCard({ persona, viewShotRef }: { persona: Persona; viewShotRef: React.RefObject<ViewShot | null> }) {
  const theme = useTheme();
  const { profileName, profileImageUri } = useAppSettings();
  const personaCardImage = personaCardImages[persona.id];
  const displayName = profileName || "Viewer";

  return (
    <ViewShot ref={viewShotRef} options={{ format: "png", quality: 1 }} style={styles.shareCard}>
      <LinearGradient
        colors={[withAlpha(theme.colors.primary, 0.15), theme.colors.background, theme.colors.background]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.shareCardGradient}
      >
        {/* User info row */}
        <View style={styles.shareUserRow}>
          {profileImageUri ? (
            <View style={[styles.shareAvatarRing, { borderColor: withAlpha(theme.colors.primary, 0.4) }]}>
              <View style={styles.shareAvatar}>
                <PersonaImage
                  source={{ uri: profileImageUri }}
                  resizeMode="cover"
                  style={{ width: 32, height: 32, borderRadius: 16 }}
                />
              </View>
            </View>
          ) : (
            <View style={[styles.shareAvatarFallback, { backgroundColor: withAlpha(theme.colors.primary, 0.15) }]}>
              <Text style={[styles.shareAvatarLetter, { color: theme.colors.primary }]}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.shareUserInfo}>
            <Text style={[styles.shareUserName, { color: theme.colors.textPrimary }]}>{displayName}</Text>
            <Text style={[styles.shareUserLabel, { color: withAlpha(theme.colors.textPrimary, 0.35) }]}>My persona card</Text>
          </View>
        </View>

        {/* Persona image */}
        <View style={styles.shareImageWrap}>
          <View style={[styles.shareImageBorder, { borderColor: withAlpha(theme.colors.primary, 0.12) }]}>
            <View style={styles.shareImage}>
              <PersonaImage source={personaCardImage} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
            </View>
          </View>
        </View>

        {/* Arcana label */}
        <Text style={[styles.shareArcana, { color: withAlpha(theme.colors.primary, 0.5) }]}>{persona.arcana}</Text>

        {/* Persona name */}
        <Text style={[styles.shareName, { color: theme.colors.textPrimary }]}>{persona.name}</Text>

        {/* Trait chips */}
        <View style={styles.shareTraitsRow}>
          {persona.traits.map((trait) => (
            <View key={trait} style={[styles.shareChip, { backgroundColor: withAlpha(theme.colors.primary, 0.1), borderColor: withAlpha(theme.colors.primary, 0.15) }]}>
              <Text style={[styles.shareChipText, { color: withAlpha(theme.colors.primary, 0.8) }]}>{trait}</Text>
            </View>
          ))}
        </View>

        {/* Motto */}
        <Text style={[styles.shareMotto, { color: withAlpha(theme.colors.textPrimary, 0.45) }]}>"{persona.motto}"</Text>

        {/* Bottom divider + watermark */}
        <View style={styles.shareBottom}>
          <View style={[styles.shareBottomLine, { backgroundColor: withAlpha(theme.colors.primary, 0.1) }]} />
          <Text style={[styles.shareWatermark, { color: withAlpha(theme.colors.primary, 0.3) }]}>STREAMBOX</Text>
        </View>
      </LinearGradient>
    </ViewShot>
  );
}

const styles = StyleSheet.create({
  shareCard: {
    width: 340,
    aspectRatio: 9 / 16,
    borderRadius: 20,
    overflow: "hidden",
  },
  shareCardGradient: {
    flex: 1,
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  shareUserRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: 18,
    gap: 10,
  },
  shareAvatarRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  shareAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: "hidden",
  },
  shareAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  shareAvatarLetter: {
    fontSize: 16,
    fontWeight: "700",
  },
  shareUserInfo: {
    gap: 1,
  },
  shareUserName: {
    fontSize: 14,
    fontWeight: "700",
  },
  shareUserLabel: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  shareImageWrap: {
    alignItems: "center",
    marginBottom: 16,
  },
  shareImageBorder: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    overflow: "hidden",
  },
  shareImage: {
    width: 160,
    height: 284,
    borderRadius: 8,
    overflow: "hidden",
  },
  shareArcana: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  shareName: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  shareTraitsRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
  },
  shareChip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  shareChipText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  shareMotto: {
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  shareBottom: {
    position: "absolute",
    bottom: 20,
    alignItems: "center",
    gap: 8,
  },
  shareBottomLine: {
    width: 40,
    height: 1,
  },
  shareWatermark: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 5,
    textTransform: "uppercase",
  },
  shareBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  shareModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  shareBackBtn: {
    padding: 4,
  },
  shareModalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  shareModalCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  shareActionBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 32,
  },
  shareActionText: {
    fontSize: 16,
    fontWeight: "700",
  },
});

function PersonaCard({ persona }: { persona: Persona }) {
  const theme = useTheme();
  const personaCardImage = personaCardImages[persona.id];
  const [fullscreen, setFullscreen] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  const [sharing, setSharing] = useState(false);
  const viewShotRef = useRef<ViewShot>(null);

  const handleShare = async () => {
    try {
      setSharing(true);
      const uri = await (viewShotRef.current as any)?.capture?.();
      if (!uri) return;

      const available = await Sharing.isAvailableAsync();
      if (!available) return;

      await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png" });
    } finally {
      setSharing(false);
    }
  };

  return (
    <Card>
      {/* Fullscreen image modal */}
      <Modal visible={fullscreen} transparent animationType="fade" statusBarTranslucent>
        <Pressable style={{ flex: 1 }} onPress={() => setFullscreen(false)}>
          <FullscreenBackdrop>
            <FullscreenImage source={personaCardImage} resizeMode="contain" />
          </FullscreenBackdrop>
        </Pressable>
      </Modal>

      {/* Share preview modal */}
      <Modal visible={shareModal} animationType="slide" statusBarTranslucent onRequestClose={() => setShareModal(false)}>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <View style={styles.shareModalHeader}>
            <Pressable onPress={() => setShareModal(false)} hitSlop={12} style={styles.shareBackBtn}>
              <Feather name="arrow-left" size={22} color={theme.colors.textPrimary} />
            </Pressable>
            <Text style={[styles.shareModalTitle, { color: theme.colors.textPrimary }]}>Share Your Persona</Text>
            <View style={{ width: 22 }} />
          </View>

          <View style={styles.shareModalCenter}>
            <ShareCard persona={persona} viewShotRef={viewShotRef} />
          </View>

          <Pressable
            style={[styles.shareActionBtn, { backgroundColor: theme.colors.primary }]}
            onPress={handleShare}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <Feather name="share-2" size={22} color={theme.colors.textPrimary} />
            )}
          </Pressable>
        </View>
      </Modal>

      {/* Share button */}
      <Pressable
        style={[styles.shareBtn, { backgroundColor: withAlpha(theme.colors.primary, 0.1) }]}
        onPress={() => setShareModal(true)}
      >
        <Feather name="share-2" size={16} color={withAlpha(theme.colors.primary, 0.6)} />
      </Pressable>

      <Pressable onPress={() => setFullscreen(true)}>
        <ImageWrap>
          <PersonaImage source={personaCardImage} resizeMode="contain" />
        </ImageWrap>
      </Pressable>

      <TraitsRow>
        {persona.traits.map((trait) => (
          <TraitChip key={trait}>
            <TraitText>{trait}</TraitText>
          </TraitChip>
        ))}
      </TraitsRow>

      <Body>
        <Motto>"{persona.motto}"</Motto>
        <Description>{persona.description}</Description>
      </Body>
    </Card>
  );
}

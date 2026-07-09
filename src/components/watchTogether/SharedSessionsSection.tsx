import { useCallback, useEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Dimensions, Modal, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { Feather } from "@expo/vector-icons";
import styled, { useTheme } from "styled-components/native";

import { useAuth } from "../../context/AuthContext";
import {
  cacheMemoryFromUrl,
  deleteWatchMemory,
  getCachedMemoryUri,
  getMemoryImageUrl,
  listWatchMemories,
  pruneCachedMemories,
  type WatchMemory,
} from "../../services/watchMemories";

// Profile → "Shared Sessions": every polaroid from a watch-together session, in
// a 3-up grid. Tapping opens the full card to share (a local file, so it works
// on Android) or delete (per-user: removed from your shelf; the partner keeps
// theirs until they delete too).

type Resolved = WatchMemory & { localUri: string | null; remoteUrl: string | null };

const POLAROID_RATIO = 430 / 320; // height / width
const SECTION_PADDING = 16;
const GRID_GAP = 10;
const COLUMNS = 3;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// Floor so three cards + two gaps always fit one row (never wrap to 2-up).
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - SECTION_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS);
const CARD_HEIGHT = Math.round(CARD_WIDTH * POLAROID_RATIO);
// Full-view polaroid, clamped so it never overflows a narrow screen.
const FULL_WIDTH = Math.min(320, SCREEN_WIDTH - 48);
const FULL_HEIGHT = Math.round(FULL_WIDTH * POLAROID_RATIO);

function displayUri(item: Resolved): string | null {
  return item.localUri ?? item.remoteUrl;
}

export function SharedSessionsSection() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isFocused = useIsFocused();

  const [memories, setMemories] = useState<Resolved[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setMemories([]);
      setLoaded(true);
      return;
    }
    try {
      const rows = await listWatchMemories(user.id);
      // Resolve each to a local file (cached, offline-friendly, shareable);
      // download from a signed URL on first sight.
      const resolved = await Promise.all(
        rows.map(async (row): Promise<Resolved> => {
          const cached = await getCachedMemoryUri(row.id);
          if (cached) return { ...row, localUri: cached, remoteUrl: null };
          const remoteUrl = await getMemoryImageUrl(row.imagePath);
          const localUri = remoteUrl ? await cacheMemoryFromUrl(row.id, remoteUrl) : null;
          return { ...row, localUri, remoteUrl };
        })
      );
      setMemories(resolved);
      void pruneCachedMemories(rows.map((row) => row.id));
    } catch {
      setMemories([]);
    } finally {
      setLoaded(true);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isFocused) void load();
  }, [isFocused, load]);

  const share = useCallback(async () => {
    const uri = active ? displayUri(active) : null;
    if (!uri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png" });
      }
    } catch {
      /* user dismissed / share unavailable */
    }
  }, [active]);

  const confirmDelete = useCallback(() => {
    if (!active) return;
    Alert.alert(
      t("watchTogether.deleteTitle", { defaultValue: "Remove this memory?" }),
      t("watchTogether.deleteBody", {
        defaultValue: "It stays on your partner's shelf until they remove it too.",
      }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("common.delete", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: () => void runDelete(active.id),
        },
      ]
    );
  }, [active, t]);

  const runDelete = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await deleteWatchMemory(id);
      setMemories((prev) => prev.filter((memory) => memory.id !== id));
      setActive(null);
    } catch {
      Alert.alert(t("common.error", { defaultValue: "Something went wrong" }));
    } finally {
      setBusy(false);
    }
  }, [t]);

  // Stay invisible until we know there is something to show — no empty flash
  // for users who have never had a session, no loading box for those who have.
  if (!loaded || memories.length === 0) return null;

  return (
    <Section>
      <Header>
        <SectionTitle>{t("watchTogether.sharedSessions", { defaultValue: "Shared Sessions" })}</SectionTitle>
        <Dot />
        <Meta>
          {t("watchTogether.sharedSessionsCount", {
            defaultValue: "{{count}} memories",
            count: memories.length,
          })}
        </Meta>
      </Header>

      <Grid>
        {memories.map((item) => {
          const uri = displayUri(item);
          return (
            <Cell
              key={item.id}
              onPress={() => setActive(item)}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              {uri ? (
                <Thumb source={{ uri }} contentFit="cover" transition={140} />
              ) : (
                <ThumbFallback>
                  <Feather name="camera" size={18} color={theme.colors.textTertiary} />
                </ThumbFallback>
              )}
            </Cell>
          );
        })}
      </Grid>

      <Modal visible={Boolean(active)} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <Backdrop>
          <CloseButton onPress={() => setActive(null)} hitSlop={12}>
            <Feather name="x" size={22} color="#fff" />
          </CloseButton>

          {active && displayUri(active) ? (
            <FullImage
              source={{ uri: displayUri(active) as string }}
              style={{ width: FULL_WIDTH, height: FULL_HEIGHT }}
              contentFit="contain"
            />
          ) : null}

          <Actions>
            <ActionButton $primary onPress={share} disabled={busy}>
              <Feather name="share-2" size={18} color="#fff" />
              <ActionText>{t("common.share", { defaultValue: "Share" })}</ActionText>
            </ActionButton>
            <ActionButton $danger onPress={confirmDelete} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="trash-2" size={18} color="#fff" />
                  <ActionText>{t("common.delete", { defaultValue: "Delete" })}</ActionText>
                </>
              )}
            </ActionButton>
          </Actions>
        </Backdrop>
      </Modal>
    </Section>
  );
}

const Section = styled(View)`
  margin-top: 30px;
  padding-horizontal: ${SECTION_PADDING}px;
`;

const Header = styled(View)`
  flex-direction: row;
  align-items: baseline;
  margin-bottom: 16px;
`;

const SectionTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  line-height: 28px;
  letter-spacing: -0.6px;
`;

const Dot = styled(View)`
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.primary};
  margin-horizontal: 8px;
  margin-bottom: 3px;
`;

const Meta = styled(Text)`
  color: rgba(255, 255, 255, 0.3);
  font-family: Outfit_500Medium;
  font-size: 13px;
`;

const Grid = styled(View)`
  flex-direction: row;
  flex-wrap: wrap;
  gap: ${GRID_GAP}px;
`;

const Cell = styled(Pressable)`
  width: ${CARD_WIDTH}px;
  height: ${CARD_HEIGHT}px;
  border-radius: 10px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const Thumb = styled(Image)`
  width: 100%;
  height: 100%;
`;

const ThumbFallback = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const Backdrop = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.9);
  padding: 40px 20px;
`;

const CloseButton = styled(Pressable)`
  position: absolute;
  top: 48px;
  left: 16px;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.12);
`;

const FullImage = styled(Image)``;

const Actions = styled(View)`
  flex-direction: row;
  gap: 12px;
  margin-top: 24px;
`;

const ActionButton = styled(Pressable)<{ $primary?: boolean; $danger?: boolean }>`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 120px;
  padding: 13px 22px;
  border-radius: 999px;
  background-color: ${({ $primary, $danger, theme }) =>
    $danger ? "#C0392B" : $primary ? theme.colors.primary : "rgba(255,255,255,0.14)"};
`;

const ActionText = styled(Text)`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 14px;
`;

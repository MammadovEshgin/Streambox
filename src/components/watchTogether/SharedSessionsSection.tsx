import { useCallback, useEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  removeCachedMemoryImage,
} from "../../services/watchMemories";
import { listLocalMemories, removeLocalMemory } from "../../services/watchMemoryLocalStore";

// Profile → "Shared Sessions": every polaroid from a watch-together session, in
// a 3-up grid. Memories show instantly from the on-device store (written the
// moment they are captured) and are reconciled with their cloud row once it
// syncs. Tapping opens the full card to share (a local file, so it works on
// Android) or delete (per-user: removed from your shelf; the partner keeps
// theirs until they delete too).

type Item = {
  key: string;
  cloudId: string | null;
  localId: string | null;
  title: string;
  uri: string | null;
  createdAtEpochMs: number;
};

const POLAROID_RATIO = 430 / 320; // height / width
const SECTION_PADDING = 16;
const GRID_GAP = 10;
const COLUMNS = 3;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// Rail cards match the poster cards in the other profile sections exactly (132x198).
const RAIL_CARD_WIDTH = 132;
const RAIL_CARD_HEIGHT = 198;
// Floor so three cards + two gaps always fit one row (never wrap to 2-up).
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - SECTION_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS);
const CARD_HEIGHT = Math.round(CARD_WIDTH * POLAROID_RATIO);
// Full-view polaroid, clamped so it never overflows a narrow screen.
const FULL_WIDTH = Math.min(320, SCREEN_WIDTH - 48);
const FULL_HEIGHT = Math.round(FULL_WIDTH * POLAROID_RATIO);

export function SharedSessionsSection() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();

  const [memories, setMemories] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [localMems, cloudRows] = await Promise.all([
        listLocalMemories(),
        user?.id ? listWatchMemories(user.id) : Promise.resolve([]),
      ]);
      const localByCloud = new Map(
        localMems.filter((m) => m.cloudId).map((m) => [m.cloudId as string, m])
      );
      const cloudIds = new Set(cloudRows.map((row) => row.id));
      const shownLocalIds = new Set<string>();
      const items: Item[] = [];

      // Cloud rows are authoritative (both participants see them). Prefer a
      // local cached file for the image; download + cache on first sight.
      for (const row of cloudRows) {
        const local = localByCloud.get(row.id);
        if (local) shownLocalIds.add(local.localId);
        let uri: string | null = local?.imageLocalUri ?? (await getCachedMemoryUri(row.id));
        if (!uri) {
          const remote = await getMemoryImageUrl(row.imagePath);
          uri = (remote ? await cacheMemoryFromUrl(row.id, remote) : null) ?? remote;
        }
        items.push({
          key: row.id,
          cloudId: row.id,
          localId: local?.localId ?? null,
          title: row.title,
          uri,
          createdAtEpochMs: row.createdAtEpochMs,
        });
      }

      // Local memories not yet represented by a visible cloud row (still
      // uploading, or the cloud row isn't readable to us).
      for (const m of localMems) {
        if (shownLocalIds.has(m.localId)) continue;
        if (m.cloudId && cloudIds.has(m.cloudId)) continue;
        items.push({
          key: m.localId,
          cloudId: m.cloudId,
          localId: m.localId,
          title: m.title,
          uri: m.imageLocalUri,
          createdAtEpochMs: m.createdAtEpochMs,
        });
      }

      items.sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs);
      setMemories(items);

      // Keep every still-live image (cloud ids + local ids) in the cache.
      const activeIds = [
        ...cloudRows.map((row) => row.id),
        ...localMems.map((m) => m.localId),
        ...localMems.flatMap((m) => (m.cloudId ? [m.cloudId] : [])),
      ];
      void pruneCachedMemories(activeIds);
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
    const uri = active?.uri ?? null;
    if (!uri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png" });
      }
    } catch {
      /* user dismissed / share unavailable */
    }
  }, [active]);

  const runDelete = useCallback(async (item: Item) => {
    setBusy(true);
    try {
      if (item.cloudId) {
        await deleteWatchMemory(item.cloudId);
        if (item.localId) await removeLocalMemory(item.localId);
      } else if (item.localId) {
        await removeLocalMemory(item.localId);
        await removeCachedMemoryImage(item.localId);
      }
      setMemories((prev) => prev.filter((m) => m.key !== item.key));
      setActive(null);
    } catch {
      Alert.alert(t("common.error", { defaultValue: "Something went wrong" }));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const confirmDelete = useCallback(() => {
    if (!active) return;
    const target = active;
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
          onPress: () => void runDelete(target),
        },
      ]
    );
  }, [active, t, runDelete]);

  // Stay invisible until we know there is something to show — no empty flash
  // for users who have never had a session, no loading box for those who have.
  if (!loaded || memories.length === 0) return null;

  const title = t("watchTogether.sharedSessions", { defaultValue: "Shared Sessions" });

  return (
    <Section>
      <Header>
        <SectionTitle>{title}</SectionTitle>
        <Dot />
        <Meta>
          {t("watchTogether.sharedSessionsCount", {
            defaultValue: "{{count}} memories",
            count: memories.length,
          })}
        </Meta>
        <SeeAllButton onPress={() => setGridOpen(true)}>
          <SeeAllText>{t("common.seeAll", { defaultValue: "See all" })}</SeeAllText>
        </SeeAllButton>
      </Header>

      {/* Horizontal rail, matching the other profile sections */}
      <FlatList
        data={memories}
        horizontal
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: SECTION_PADDING }}
        renderItem={({ item }) => (
          <RailCardWrap>
            <RailCard onPress={() => setActive(item)} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              {item.uri ? (
                <RailThumb source={{ uri: item.uri }} contentFit="contain" transition={140} />
              ) : (
                <ThumbFallback>
                  <Feather name="camera" size={18} color={theme.colors.textTertiary} />
                </ThumbFallback>
              )}
            </RailCard>
          </RailCardWrap>
        )}
      />

      {/* "See all" → full 3-up grid */}
      <Modal visible={gridOpen} animationType="slide" onRequestClose={() => setGridOpen(false)}>
        <GridScreen style={{ paddingTop: insets.top }}>
          <GridHeader>
            <Pressable onPress={() => setGridOpen(false)} hitSlop={12}>
              <Feather name="chevron-left" size={24} color={theme.colors.textPrimary} />
            </Pressable>
            <GridTitle>{title}</GridTitle>
            <View style={{ width: 24 }} />
          </GridHeader>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: SECTION_PADDING, paddingBottom: insets.bottom + 24 }}
          >
            <Grid>
              {memories.map((item) => (
                <Cell
                  key={item.key}
                  onPress={() => setActive(item)}
                  style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
                >
                  {item.uri ? (
                    <Thumb source={{ uri: item.uri }} contentFit="cover" transition={140} />
                  ) : (
                    <ThumbFallback>
                      <Feather name="camera" size={18} color={theme.colors.textTertiary} />
                    </ThumbFallback>
                  )}
                </Cell>
              ))}
            </Grid>
          </ScrollView>
        </GridScreen>
      </Modal>

      <Modal visible={Boolean(active)} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <Backdrop>
          <CloseButton onPress={() => setActive(null)} hitSlop={12}>
            <Feather name="x" size={22} color="#fff" />
          </CloseButton>

          {active?.uri ? (
            <FullImage
              source={{ uri: active.uri }}
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

const SeeAllButton = styled(Pressable)`
  margin-left: auto;
  padding: 2px 0;
`;

const SeeAllText = styled(Text)`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 13px;
`;

const RailCardWrap = styled(View)`
  margin-right: 12px;
`;

const RailCard = styled(Pressable)`
  width: ${RAIL_CARD_WIDTH}px;
  height: ${RAIL_CARD_HEIGHT}px;
  border-radius: 14px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
`;

const RailThumb = styled(Image)`
  width: 100%;
  height: 100%;
`;

const GridScreen = styled(View)`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const GridHeader = styled(View)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 14px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const GridTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 18px;
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

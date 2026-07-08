import { useCallback, useEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { FlatList, Modal, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { Feather } from "@expo/vector-icons";
import styled, { useTheme } from "styled-components/native";

import { useAuth } from "../../context/AuthContext";
import { getMemoryImageUrl, listWatchMemories, type WatchMemory } from "../../services/watchMemories";

type Resolved = WatchMemory & { url: string | null };

export function MovieMemoriesShelf() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const [memories, setMemories] = useState<Resolved[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Resolved | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const rows = await listWatchMemories(user.id);
      const resolved = await Promise.all(
        rows.map(async (row) => ({ ...row, url: await getMemoryImageUrl(row.imagePath) }))
      );
      setMemories(resolved);
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
    if (!active?.url) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(active.url, { mimeType: "image/png", UTI: "public.png" });
    }
  }, [active]);

  if (loaded && memories.length === 0) {
    return null; // hide the shelf entirely until the first memory exists
  }

  return (
    <Wrap>
      <Header>
        <Feather name="camera" size={16} color={theme.colors.primary} />
        <Title>{t("watchTogether.memories")}</Title>
      </Header>
      <FlatList
        data={memories}
        horizontal
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.85} onPress={() => setActive(item)}>
            <Card>
              {item.url ? <Thumb source={{ uri: item.url }} contentFit="cover" /> : <ThumbFallback />}
              <CardTitle numberOfLines={1}>{item.title}</CardTitle>
              <CardSub numberOfLines={1}>{item.participantNicknames.join(" & ")}</CardSub>
            </Card>
          </TouchableOpacity>
        )}
      />

      <Modal visible={Boolean(active)} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <Backdrop>
          {active?.url ? <Full source={{ uri: active.url }} contentFit="contain" /> : null}
          <Actions>
            <ActionButton $primary onPress={share}>
              <Feather name="share-2" size={18} color="#fff" />
              <ActionText>Share</ActionText>
            </ActionButton>
            <ActionButton onPress={() => setActive(null)}>
              <ActionText>Close</ActionText>
            </ActionButton>
          </Actions>
        </Backdrop>
      </Modal>
    </Wrap>
  );
}

const Wrap = styled(View)`
  margin-top: 8px;
  margin-bottom: 12px;
`;

const Header = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0 16px 12px 16px;
`;

const Title = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
`;

const Card = styled(View)`
  width: 132px;
`;

const Thumb = styled(Image)`
  width: 132px;
  height: 176px;
  border-radius: 8px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const ThumbFallback = styled(View)`
  width: 132px;
  height: 176px;
  border-radius: 8px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const CardTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  font-weight: 600;
  margin-top: 6px;
`;

const CardSub = styled(Text)`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  margin-top: 2px;
`;

const Backdrop = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.85);
`;

const Full = styled(Image)`
  width: 320px;
  height: 440px;
`;

const Actions = styled(View)`
  flex-direction: row;
  gap: 12px;
  margin-top: 20px;
`;

const ActionButton = styled(TouchableOpacity)<{ $primary?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  border-radius: 999px;
  background-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : "rgba(255,255,255,0.14)")};
`;

const ActionText = styled(Text)`
  color: #ffffff;
  font-weight: 700;
`;

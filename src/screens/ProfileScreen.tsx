import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { type NativeStackScreenProps } from "@react-navigation/native-stack";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  TouchableWithoutFeedback,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import { type MediaItem, type MediaType } from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { MediaCard } from "../components/home/MediaCard";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { useLikedSeries } from "../hooks/useLikedSeries";
import { useSeriesWatchlist } from "../hooks/useSeriesWatchlist";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { useWatchlist } from "../hooks/useWatchlist";
import type { ProfileSeeAllSection, ProfileStackParamList } from "../navigation/types";
import { useAppSettings } from "../settings/AppSettingsContext";
import { getSharedHydratedMediaCache, hydrateMediaIds, type HydratedMediaCache } from "../services/mediaHydration";
import { searchLocationSuggestions } from "../services/locationSearch";
import { storeBannerImageFromUri, storeProfileImageFromUri } from "../services/profileImageService";

type ProfileScreenProps = NativeStackScreenProps<ProfileStackParamList, "ProfileFeed">;

type HydratedCache = HydratedMediaCache;

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// â”€â”€ Layout constants â”€â”€
const BANNER_HEIGHT = 160;
const AVATAR_SIZE = 80;
const AVATAR_OVERLAP = AVATAR_SIZE / 2;

// â”€â”€ Styled Components â”€â”€

const Content = styled.ScrollView.attrs({
  showsVerticalScrollIndicator: false,
  keyboardShouldPersistTaps: "handled",
})`
  flex: 1;
`;

const Header = styled.View`
  padding-bottom: 12px;
`;

const BannerWrap = styled.Pressable`
  height: ${BANNER_HEIGHT}px;
  background-color: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
`;

const BannerImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const BannerPlaceholder = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const BannerTopActions = styled.View`
  position: absolute;
  top: 10px;
  right: 12px;
  flex-direction: row;
  gap: 8px;
  z-index: 10;
`;

const BannerIconButton = styled.Pressable`
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background-color: rgba(0, 0, 0, 0.5);
`;

const AvatarArea = styled.View`
  margin-top: -${AVATAR_OVERLAP}px;
  padding-horizontal: 16px;
`;

const AvatarButton = styled.Pressable``;

const AvatarCircle = styled.View`
  width: ${AVATAR_SIZE}px;
  height: ${AVATAR_SIZE}px;
  border-radius: ${AVATAR_SIZE / 2}px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.background};
  border-width: 3px;
  border-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const AvatarInner = styled.View`
  width: 100%;
  height: 100%;
  border-radius: ${AVATAR_SIZE / 2}px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  align-items: center;
  justify-content: center;
`;

const AvatarImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const ProfileInfo = styled.View`
  padding-horizontal: 16px;
  margin-top: 10px;
  gap: 4px;
`;

const ProfileTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin-top: 4px;
`;

const ProfileBio = styled.Text`
  margin-top: 8px;
  color: #ffffff;
  font-size: 15px;
  line-height: 22px;
  font-weight: 400;
  letter-spacing: 0.1px;
`;

const MetaStack = styled.View`
  align-items: flex-start;
  margin-top: 16px;
  gap: 8px;
`;

const MetaItem = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding-vertical: 2px;
`;

const MetaText = styled.Text`
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.1px;
`;

const StatsRow = styled.View`
  flex-direction: row;
  justify-content: flex-start;
  gap: 20px;
  margin-top: 20px;
  padding-bottom: 20px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const StatItem = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
`;

const StatNumber = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
  font-weight: 700;
`;

const StatLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  font-weight: 400;
`;

const SectionWrap = styled.View`
  margin-top: 30px;
  padding-horizontal: 16px;
`;

const SectionHeader = styled.View`
  flex-direction: row;
  align-items: baseline;
  margin-bottom: 16px;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.4px;
`;

const SectionDot = styled.View`
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.primary};
  margin-horizontal: 8px;
  margin-bottom: 3px;
`;

const SectionMeta = styled.Text`
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
  font-weight: 500;
`;

const SeeAllButton = styled.Pressable`
  margin-left: auto;
  padding: 2px 0;
`;

const SeeAllText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 600;
`;

const ToggleRow = styled.View`
  flex-direction: row;
  gap: 6px;
  margin-bottom: 14px;
`;

const ToggleChip = styled.Pressable<{ $active: boolean }>`
  padding: 6px 14px;
  border-radius: 5px;
  background-color: ${({ $active, theme }) =>
    $active ? `${theme.colors.primary}15` : "rgba(255,255,255,0.04)"};
  border-width: 1px;
  border-color: ${({ $active, theme }) =>
    $active ? `${theme.colors.primary}30` : "transparent"};
`;

const ToggleLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary : "rgba(255,255,255,0.35)"};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const RailWrap = styled.View`
  height: 282px;
`;

const RailCardWrap = styled.View`
  margin-right: 12px;
`;

const EmptySection = styled.View`
  height: 140px;
  border-radius: 5px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.06);
  background-color: rgba(255, 255, 255, 0.02);
  align-items: center;
  justify-content: center;
`;

const EmptyIcon = styled.View`
  margin-bottom: 8px;
  opacity: 0.3;
`;

const EmptyText = styled.Text`
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const BottomSpacer = styled.View`
  height: 40px;
`;

// â”€â”€ Full-view modal styles â”€â”€

const FullViewOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.95);
  align-items: center;
  justify-content: center;
`;

const FullViewClose = styled.Pressable`
  position: absolute;
  top: 50px;
  left: 16px;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: rgba(255, 255, 255, 0.1);
  align-items: center;
  justify-content: center;
`;

const FullViewImage = styled.Image`
  width: ${SCREEN_WIDTH}px;
`;

const FullViewActions = styled.View`
  position: absolute;
  bottom: 50px;
  align-self: center;
`;

const FullViewEditButton = styled.Pressable`
  padding: 12px 28px;
  border-radius: 3px;
  background-color: rgba(0, 0, 0, 0.7);
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.primary};
`;

const FullViewEditLabel = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 15px;
  font-weight: 700;
`;

// â”€â”€ Edit profile modal styles â”€â”€

const EditModalOverlay = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const EditModalHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const EditModalTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  font-weight: 700;
`;

const EditModalSaveButton = styled.Pressable`
  padding: 8px 20px;
  border-radius: 3px;
  background-color: ${({ theme }) => theme.colors.background};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.primary};
`;

const EditModalSaveLabel = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 14px;
  font-weight: 700;
`;

const EditModalContent = styled.ScrollView.attrs({
  showsVerticalScrollIndicator: false,
  keyboardShouldPersistTaps: "handled",
})`
  flex: 1;
`;

const EditField = styled.View`
  padding: 16px 16px 0;
`;

const EditFieldLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
`;

const EditFieldInput = styled(TextInput)`
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
  padding: 8px 0 12px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
`;

const SuggestionList = styled.View`
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-radius: 8px;
  margin-top: 4px;
  overflow: hidden;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  elevation: 5;
  shadow-color: #000;
  shadow-offset: 0px 4px;
  shadow-opacity: 0.3;
  shadow-radius: 4px;
`;

const SuggestionItem = styled.Pressable`
  padding: 12px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const SuggestionText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
`;

const SuggestionStatus = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
`;

// â”€â”€ Helpers â”€â”€

function formatJoinedDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `Joined ${d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}`;
  } catch {
    return "";
  }
}

function formatBirthday(dateStr: string): string {
  if (!dateStr) return "";
  try {
    // Parse dd/mm/yyyy
    const parts = dateStr.split("/");
    if (parts.length !== 3) return "";
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    if (isNaN(d.getTime())) return "";
    const monthName = d.toLocaleDateString("en-US", { month: "long" });
    return `Born ${day} ${monthName} ${year}`;
  } catch {
    return "";
  }
}

function formatBirthdayInput(raw: string): string {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

// â”€â”€ Component â”€â”€

export function ProfileScreen({ navigation }: ProfileScreenProps) {
  const currentTheme = useTheme();
  const insets = useSafeAreaInsets();
  const {
    profileImageUri,
    profileName,
    profileBio,
    profileLocation,
    profileBirthday,
    joinedDate,
    bannerImageUri,
    setProfileImageUri,
    setBannerImageUri,
    updateProfile,
  } = useAppSettings();

  const { watchlist: movieWatchlist, isLoading: wlLoading } = useWatchlist();
  const { watchlist: seriesWatchlist, isLoading: swlLoading } = useSeriesWatchlist();
  const { likedMovies, isLoading: lmLoading } = useLikedMovies();
  const { likedSeries, isLoading: lsLoading } = useLikedSeries();
  const { history: watchHistory, isLoading: whLoading } = useWatchHistory();

  const [avatarKey, setAvatarKey] = useState(Date.now());
  const [bannerKey, setBannerKey] = useState(Date.now());
  const [watchlistMovieItems, setWatchlistMovieItems] = useState<MediaItem[]>([]);
  const [watchlistSeriesItems, setWatchlistSeriesItems] = useState<MediaItem[]>([]);
  const [likedMovieItems, setLikedMovieItems] = useState<MediaItem[]>([]);
  const [likedSeriesItems, setLikedSeriesItems] = useState<MediaItem[]>([]);
  const [isHydrating, setIsHydrating] = useState(true);

  const [watchedFilter, setWatchedFilter] = useState<"movie" | "tv">("movie");
  const [watchlistFilter, setWatchlistFilter] = useState<"movie" | "tv">("movie");
  const [likedFilter, setLikedFilter] = useState<"movie" | "tv">("movie");

  // Modal states
  const [fullViewType, setFullViewType] = useState<"avatar" | "banner" | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Edit profile draft state
  const [draftName, setDraftName] = useState(profileName);
  const [draftBio, setDraftBio] = useState(profileBio);
  const [draftLocation, setDraftLocation] = useState(profileLocation);
  const [draftBirthday, setDraftBirthday] = useState(profileBirthday);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const locationSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationAbortRef = useRef<AbortController | null>(null);
  const locationRequestRef = useRef(0);

  const clearLocationSearch = useCallback(() => {
    if (locationSearchTimeoutRef.current) {
      clearTimeout(locationSearchTimeoutRef.current);
      locationSearchTimeoutRef.current = null;
    }

    locationAbortRef.current?.abort();
    locationAbortRef.current = null;
    locationRequestRef.current += 1;
    setIsSearchingLocation(false);
  }, []);

  const runLocationSearch = useCallback((query: string) => {
    const trimmedQuery = query.trim();
    const requestId = locationRequestRef.current + 1;
    locationRequestRef.current = requestId;

    if (trimmedQuery.length < 2) {
      clearLocationSearch();
      setLocationSuggestions([]);
      return;
    }

    if (locationSearchTimeoutRef.current) {
      clearTimeout(locationSearchTimeoutRef.current);
    }

    locationAbortRef.current?.abort();
    const controller = new AbortController();
    locationAbortRef.current = controller;
    setIsSearchingLocation(true);

    locationSearchTimeoutRef.current = setTimeout(() => {
      void searchLocationSuggestions(trimmedQuery, controller.signal, 6)
        .then((results) => {
          if (locationRequestRef.current !== requestId) {
            return;
          }

          const filteredResults = results.filter(
            (result) => result.toLowerCase() !== trimmedQuery.toLowerCase()
          );
          setLocationSuggestions(filteredResults);
        })
        .catch(() => {
          if (locationRequestRef.current === requestId) {
            setLocationSuggestions([]);
          }
        })
        .finally(() => {
          if (locationRequestRef.current === requestId) {
            setIsSearchingLocation(false);
            locationAbortRef.current = null;
          }
        });
    }, 250);
  }, [clearLocationSearch]);

  const handleLocationChange = useCallback((text: string) => {
    setDraftLocation(text);
    runLocationSearch(text);
  }, [runLocationSearch]);

  const handleSelectLocationSuggestion = useCallback((suggestion: string) => {
    setDraftLocation(suggestion);
    clearLocationSearch();
    setLocationSuggestions([]);
    Keyboard.dismiss();
  }, [clearLocationSearch]);

  const cacheRef = useRef<HydratedCache>(getSharedHydratedMediaCache());

  const hooksLoading = wlLoading || swlLoading || lmLoading || lsLoading || whLoading;

  useEffect(() => {
    if (hooksLoading) return;

    let cancelled = false;
    const hasHydratedContent =
      watchlistMovieItems.length > 0
      || watchlistSeriesItems.length > 0
      || likedMovieItems.length > 0
      || likedSeriesItems.length > 0;

    if (!hasHydratedContent) {
      setIsHydrating(true);
    }

    async function hydrate() {
      const cache = cacheRef.current;

      const [wlMovies, wlSeries, lkMovies, lkSeries] = await Promise.all([
        hydrateMediaIds(movieWatchlist, [], cache),
        hydrateMediaIds([], seriesWatchlist, cache),
        hydrateMediaIds(likedMovies, [], cache),
        hydrateMediaIds([], likedSeries, cache),
      ]);

      if (!cancelled) {
        startTransition(() => {
          setWatchlistMovieItems(wlMovies);
          setWatchlistSeriesItems(wlSeries);
          setLikedMovieItems(lkMovies);
          setLikedSeriesItems(lkSeries);
          setIsHydrating(false);
        });
      }
    }

    void hydrate();
    return () => { cancelled = true; };
  }, [
    hooksLoading,
    likedMovieItems.length,
    likedMovies,
    likedSeries,
    likedSeriesItems.length,
    movieWatchlist,
    seriesWatchlist,
    watchlistMovieItems.length,
    watchlistSeriesItems.length,
  ]);

  // â”€â”€ Image pickers â”€â”€

  const handlePickProfileImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to set a profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    try {
      const storedUri = await storeProfileImageFromUri(result.assets[0].uri);
      await setProfileImageUri(storedUri);
      setAvatarKey(Date.now());
    } catch {
      Alert.alert("Image error", "StreamBox could not save that profile image.");
    }
  }, [setProfileImageUri]);

  const handlePickBannerImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to set a banner image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    try {
      const storedUri = await storeBannerImageFromUri(result.assets[0].uri);
      await setBannerImageUri(storedUri);
      setBannerKey(Date.now());
    } catch {
      Alert.alert("Image error", "StreamBox could not save that banner image.");
    }
  }, [setBannerImageUri]);

  useEffect(() => {
    return () => {
      clearLocationSearch();
    };
  }, [clearLocationSearch]);

  // â”€â”€ Edit profile â”€â”€

  const openEditModal = useCallback(() => {
    clearLocationSearch();
    setLocationSuggestions([]);
    setDraftName(profileName);
    setDraftBio(profileBio);
    setDraftLocation(profileLocation);
    setDraftBirthday(profileBirthday);
    setShowEditModal(true);
  }, [clearLocationSearch, profileName, profileBio, profileLocation, profileBirthday]);

  const draftLocationRef = useRef(draftLocation);
  const draftNameRef = useRef(draftName);
  const draftBioRef = useRef(draftBio);
  const draftBirthdayRef = useRef(draftBirthday);

  // Keep refs in sync so the save callback always reads fresh values
  draftLocationRef.current = draftLocation;
  draftNameRef.current = draftName;
  draftBioRef.current = draftBio;
  draftBirthdayRef.current = draftBirthday;

  const handleSaveProfile = useCallback(async () => {
    const loc = draftLocationRef.current.trim();
    const name = draftNameRef.current;
    const bio = draftBioRef.current.trim();
    const bday = draftBirthdayRef.current.trim();

    clearLocationSearch();
    setLocationSuggestions([]);
    setDraftLocation(loc);
    setDraftBio(bio);
    setDraftBirthday(bday);

    await updateProfile({
      profileName: name,
      profileBio: bio,
      profileLocation: loc,
      profileBirthday: bday,
    });

    setShowEditModal(false);
  }, [clearLocationSearch, updateProfile]);

  // â”€â”€ List helpers â”€â”€

  const watchlistItems = watchlistFilter === "movie" ? watchlistMovieItems : watchlistSeriesItems;
  const likedItems = likedFilter === "movie" ? likedMovieItems : likedSeriesItems;

  const handlePressItem = useCallback(
    (item: MediaItem) => {
      if (item.mediaType === "movie") {
        navigation.navigate("MovieDetail", { movieId: String(item.id) });
      } else {
        navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
      }
    },
    [navigation]
  );

  const handleSeeAll = useCallback(
    (section: ProfileSeeAllSection, filter: "movie" | "tv") => {
      navigation.navigate("ProfileSeeAll", { section, filter });
    },
    [navigation]
  );

  const renderCard = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => (
      <RailCardWrap>
        <MediaCard item={item} onPress={() => handlePressItem(item)} />
      </RailCardWrap>
    ),
    [handlePressItem]
  );

  const keyExtractor = useCallback((item: MediaItem) => `${item.mediaType}-${item.id}`, []);

  const watchedMovieItems: MediaItem[] = useMemo(
    () =>
      watchHistory
        .filter((entry) => entry.mediaType === "movie")
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          posterPath: entry.posterPath,
          backdropPath: null,
          rating: entry.voteAverage,
          overview: "",
          year: entry.year,
          mediaType: "movie" as MediaType,
        })),
    [watchHistory]
  );

  const watchedSeriesItems: MediaItem[] = useMemo(
    () =>
      watchHistory
        .filter((entry) => entry.mediaType === "tv")
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          posterPath: entry.posterPath,
          backdropPath: null,
          rating: entry.voteAverage,
          overview: "",
          year: entry.year,
          mediaType: "tv" as MediaType,
        })),
    [watchHistory]
  );

  if ((hooksLoading || isHydrating) && watchlistMovieItems.length === 0 && watchlistSeriesItems.length === 0 && likedMovieItems.length === 0 && likedSeriesItems.length === 0) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader size={48} label="Loading profile..." />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  const watchlistCount = movieWatchlist.length + seriesWatchlist.length;
  const likedCount = likedMovies.length + likedSeries.length;
  const watchedCount = watchHistory.length;
  const watchedItems = watchedFilter === "movie" ? watchedMovieItems : watchedSeriesItems;
  const joinedText = formatJoinedDate(joinedDate);
  const birthdayText = formatBirthday(profileBirthday);

  return (
    <SafeContainer>
      <Content>
        <Header>
          {/* Banner */}
          <BannerWrap onPress={() => setFullViewType("banner")}>
            {bannerImageUri ? (
              <BannerImage source={{ uri: `${bannerImageUri}${bannerImageUri.includes("?") ? "&" : "?"}t=${bannerKey}` }} resizeMode="cover" />
            ) : (
              <BannerPlaceholder>
                <Feather name="image" size={28} color={currentTheme.colors.textSecondary} />
              </BannerPlaceholder>
            )}
          </BannerWrap>

          <BannerTopActions>
            <BannerIconButton onPress={openEditModal}>
              <Feather name="edit-2" size={16} color="#ffffff" />
            </BannerIconButton>
            <BannerIconButton onPress={() => navigation.navigate("ProfileSettings")}>
              <Feather name="settings" size={18} color="#ffffff" />
            </BannerIconButton>
          </BannerTopActions>

          {/* Avatar */}
          <AvatarArea>
            <AvatarButton onPress={() => setFullViewType("avatar")}>
              <AvatarCircle>
                <AvatarInner>
                  {profileImageUri ? (
                    <AvatarImage source={{ uri: `${profileImageUri}${profileImageUri.includes("?") ? "&" : "?"}t=${avatarKey}` }} resizeMode="cover" />
                  ) : (
                    <Feather name="user" size={32} color={currentTheme.colors.primary} />
                  )}
                </AvatarInner>
              </AvatarCircle>
            </AvatarButton>
          </AvatarArea>

          {/* Name, Bio, Meta info */}
          <ProfileInfo>
            <ProfileTitle>{profileName}</ProfileTitle>
            {!!profileBio && <ProfileBio>{profileBio}</ProfileBio>}

            <MetaStack>
              {/* Location first */}
              {!!profileLocation && (
                <MetaItem>
                  <Feather name="map-pin" size={14} color={currentTheme.colors.primary} />
                  <MetaText>{profileLocation}</MetaText>
                </MetaItem>
              )}
              {/* Birthday second */}
              {!!birthdayText && (
                <MetaItem>
                  <Feather name="gift" size={14} color={currentTheme.colors.primary} />
                  <MetaText>{birthdayText}</MetaText>
                </MetaItem>
              )}
              {/* Joined date third */}
              {!!joinedText && (
                <MetaItem>
                  <Feather name="calendar" size={14} color={currentTheme.colors.primary} />
                  <MetaText>{joinedText}</MetaText>
                </MetaItem>
              )}
            </MetaStack>

            <StatsRow>
              <StatItem>
                <StatNumber>{watchedCount}</StatNumber>
                <StatLabel>Watched</StatLabel>
              </StatItem>
              <StatItem>
                <StatNumber>{watchlistCount}</StatNumber>
                <StatLabel>Watchlist</StatLabel>
              </StatItem>
              <StatItem>
                <StatNumber>{likedCount}</StatNumber>
                <StatLabel>Liked</StatLabel>
              </StatItem>
            </StatsRow>
          </ProfileInfo>
        </Header>

        <SectionWrap>
          <SectionHeader>
            <SectionTitle>Watched</SectionTitle>
            <SectionDot />
            <SectionMeta>{watchedItems.length} {watchedFilter === "movie" ? "movies" : "series"}</SectionMeta>
            <SeeAllButton onPress={() => handleSeeAll("watched", watchedFilter)}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <ToggleRow>
            <ToggleChip $active={watchedFilter === "movie"} onPress={() => setWatchedFilter("movie")}>
              <ToggleLabel $active={watchedFilter === "movie"}>Movies</ToggleLabel>
            </ToggleChip>
            <ToggleChip $active={watchedFilter === "tv"} onPress={() => setWatchedFilter("tv")}>
              <ToggleLabel $active={watchedFilter === "tv"}>Series</ToggleLabel>
            </ToggleChip>
          </ToggleRow>
          {watchedItems.length === 0 ? (
            <EmptySection>
              <EmptyIcon>
                <Feather name="play-circle" size={24} color={currentTheme.colors.textSecondary} />
              </EmptyIcon>
              <EmptyText>No {watchedFilter === "movie" ? "movies" : "series"} watched yet</EmptyText>
            </EmptySection>
          ) : (
            <RailWrap>
              <FlatList
                data={watchedItems}
                horizontal
                keyExtractor={keyExtractor}
                renderItem={renderCard}
                showsHorizontalScrollIndicator={false}
              />
            </RailWrap>
          )}
        </SectionWrap>

        <SectionWrap>
          <SectionHeader>
            <SectionTitle>Watchlist</SectionTitle>
            <SectionDot />
            <SectionMeta>{watchlistItems.length} {watchlistFilter === "movie" ? "movies" : "series"}</SectionMeta>
            <SeeAllButton onPress={() => handleSeeAll("watchlist", watchlistFilter)}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <ToggleRow>
            <ToggleChip $active={watchlistFilter === "movie"} onPress={() => setWatchlistFilter("movie")}>
              <ToggleLabel $active={watchlistFilter === "movie"}>Movies</ToggleLabel>
            </ToggleChip>
            <ToggleChip $active={watchlistFilter === "tv"} onPress={() => setWatchlistFilter("tv")}>
              <ToggleLabel $active={watchlistFilter === "tv"}>Series</ToggleLabel>
            </ToggleChip>
          </ToggleRow>
          {watchlistItems.length === 0 ? (
            <EmptySection>
              <EmptyIcon>
                <Feather name="bookmark" size={24} color={currentTheme.colors.textSecondary} />
              </EmptyIcon>
              <EmptyText>No {watchlistFilter === "movie" ? "movies" : "series"} in watchlist</EmptyText>
            </EmptySection>
          ) : (
            <RailWrap>
              <FlatList
                data={watchlistItems}
                horizontal
                keyExtractor={keyExtractor}
                renderItem={renderCard}
                showsHorizontalScrollIndicator={false}
              />
            </RailWrap>
          )}
        </SectionWrap>

        <SectionWrap>
          <SectionHeader>
            <SectionTitle>Liked</SectionTitle>
            <SectionDot />
            <SectionMeta>{likedItems.length} {likedFilter === "movie" ? "movies" : "series"}</SectionMeta>
            <SeeAllButton onPress={() => handleSeeAll("liked", likedFilter)}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <ToggleRow>
            <ToggleChip $active={likedFilter === "movie"} onPress={() => setLikedFilter("movie")}>
              <ToggleLabel $active={likedFilter === "movie"}>Movies</ToggleLabel>
            </ToggleChip>
            <ToggleChip $active={likedFilter === "tv"} onPress={() => setLikedFilter("tv")}>
              <ToggleLabel $active={likedFilter === "tv"}>Series</ToggleLabel>
            </ToggleChip>
          </ToggleRow>
          {likedItems.length === 0 ? (
            <EmptySection>
              <EmptyIcon>
                <Feather name="heart" size={24} color={currentTheme.colors.textSecondary} />
              </EmptyIcon>
              <EmptyText>No {likedFilter === "movie" ? "movies" : "series"} liked yet</EmptyText>
            </EmptySection>
          ) : (
            <RailWrap>
              <FlatList
                data={likedItems}
                horizontal
                keyExtractor={keyExtractor}
                renderItem={renderCard}
                showsHorizontalScrollIndicator={false}
              />
            </RailWrap>
          )}
        </SectionWrap>

        <BottomSpacer />
      </Content>

      {/* â”€â”€ Full-view image modal â”€â”€ */}
      <Modal visible={fullViewType !== null} transparent animationType="fade" statusBarTranslucent>
        <FullViewOverlay>
          <FullViewClose onPress={() => setFullViewType(null)}>
            <Feather name="x" size={22} color="#ffffff" />
          </FullViewClose>

          {fullViewType === "avatar" && profileImageUri ? (
            <FullViewImage
              source={{ uri: `${profileImageUri}${profileImageUri.includes("?") ? "&" : "?"}t=${avatarKey}` }}
              style={{ height: SCREEN_WIDTH }}
              resizeMode="contain"
            />
          ) : fullViewType === "avatar" ? (
            <Feather name="user" size={120} color={currentTheme.colors.textSecondary} />
          ) : null}

          {fullViewType === "banner" && bannerImageUri ? (
            <FullViewImage
              source={{ uri: `${bannerImageUri}${bannerImageUri.includes("?") ? "&" : "?"}t=${bannerKey}` }}
              style={{ height: SCREEN_WIDTH * (9 / 16) }}
              resizeMode="contain"
            />
          ) : fullViewType === "banner" && !bannerImageUri ? (
            <Feather name="image" size={80} color={currentTheme.colors.textSecondary} />
          ) : null}

          <FullViewActions>
            <FullViewEditButton
              onPress={() => {
                setFullViewType(null);
                if (fullViewType === "avatar") {
                  void handlePickProfileImage();
                } else {
                  void handlePickBannerImage();
                }
              }}
            >
              <FullViewEditLabel>Edit</FullViewEditLabel>
            </FullViewEditButton>
          </FullViewActions>
        </FullViewOverlay>
      </Modal>

      {/* â”€â”€ Edit profile modal â”€â”€ */}
      <Modal visible={showEditModal} animationType="slide" statusBarTranslucent>
        <EditModalOverlay style={{ paddingTop: insets.top }}>
          <EditModalHeader>
            <Pressable onPress={() => {
              clearLocationSearch();
              setLocationSuggestions([]);
              setShowEditModal(false);
            }} hitSlop={8}>
              <Feather name="x" size={22} color={currentTheme.colors.textPrimary} />
            </Pressable>
            <EditModalTitle>Edit profile</EditModalTitle>
            <EditModalSaveButton onPress={() => void handleSaveProfile()}>
              <EditModalSaveLabel>Save</EditModalSaveLabel>
            </EditModalSaveButton>
          </EditModalHeader>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <EditModalContent>
                {/* Banner preview + change */}
                <Pressable onPress={() => void handlePickBannerImage()} style={{ height: 120, backgroundColor: currentTheme.colors.surfaceRaised }}>
                  {bannerImageUri ? (
                    <BannerImage source={{ uri: `${bannerImageUri}${bannerImageUri.includes("?") ? "&" : "?"}t=${bannerKey}` }} resizeMode="cover" style={{ height: 120 }} />
                  ) : null}
                  <Pressable
                    onPress={() => void handlePickBannerImage()}
                    style={{
                      position: "absolute",
                      alignSelf: "center",
                      top: 44,
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: "rgba(0,0,0,0.6)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather name="camera" size={18} color="#ffffff" />
                  </Pressable>
                </Pressable>

                {/* Avatar preview + change */}
                <Pressable
                  onPress={() => void handlePickProfileImage()}
                  style={{
                    marginTop: -30,
                    marginLeft: 16,
                    width: 60,
                    height: 60,
                    borderRadius: 30,
                    borderWidth: 3,
                    borderColor: currentTheme.colors.background,
                    backgroundColor: currentTheme.colors.surface,
                    overflow: "hidden",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {profileImageUri ? (
                    <AvatarImage source={{ uri: `${profileImageUri}${profileImageUri.includes("?") ? "&" : "?"}t=${avatarKey}` }} resizeMode="cover" />
                  ) : (
                    <Feather name="user" size={24} color={currentTheme.colors.primary} />
                  )}
                  <Pressable
                    onPress={() => void handlePickProfileImage()}
                    style={{
                      position: "absolute",
                      width: 60,
                      height: 60,
                      borderRadius: 30,
                      backgroundColor: "rgba(0,0,0,0.35)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather name="camera" size={18} color="#ffffff" />
                  </Pressable>
                </Pressable>

                <EditField>
                  <EditFieldLabel>Name</EditFieldLabel>
                  <EditFieldInput
                    value={draftName}
                    onChangeText={setDraftName}
                    placeholder="Your name"
                    placeholderTextColor={currentTheme.colors.textSecondary}
                    autoCapitalize="words"
                    maxLength={50}
                  />
                </EditField>

                <EditField>
                  <EditFieldLabel>Bio</EditFieldLabel>
                  <EditFieldInput
                    value={draftBio}
                    onChangeText={setDraftBio}
                    placeholder="Add a bio"
                    placeholderTextColor={currentTheme.colors.textSecondary}
                    multiline
                    maxLength={160}
                    style={{ minHeight: 50, textAlignVertical: "top" }}
                  />
                </EditField>

                <EditField>
                  <EditFieldLabel>Location</EditFieldLabel>
                  <EditFieldInput
                    value={draftLocation}
                    onChangeText={handleLocationChange}
                    placeholder="Add your location"
                    placeholderTextColor={currentTheme.colors.textSecondary}
                    maxLength={60}
                  />
                  {locationSuggestions.length > 0 && (
                    <SuggestionList>
                      {locationSuggestions.map((suggestion) => (
                        <SuggestionItem
                          key={suggestion}
                          onPress={() => handleSelectLocationSuggestion(suggestion)}
                        >
                          <SuggestionText>{suggestion}</SuggestionText>
                        </SuggestionItem>
                      ))}
                    </SuggestionList>
                  )}
                  {isSearchingLocation && <SuggestionStatus>Searching locations...</SuggestionStatus>}
                </EditField>

                <EditField>
                  <EditFieldLabel>Birthday</EditFieldLabel>
                  <EditFieldInput
                    value={draftBirthday}
                    onChangeText={(text) => setDraftBirthday(formatBirthdayInput(text))}
                    placeholder="DD/MM/YYYY"
                    placeholderTextColor={currentTheme.colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={10}
                  />
                </EditField>

                <BottomSpacer />
              </EditModalContent>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </EditModalOverlay>
      </Modal>
    </SafeContainer>
  );
}





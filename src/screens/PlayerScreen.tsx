import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ScreenOrientation from "expo-screen-orientation";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions
} from "react-native";
import { useVideoPlayer, VideoView, type ContentType, type SubtitleTrack } from "expo-video";
import YoutubeIframe from "react-native-youtube-iframe";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";

import { MovieLoader } from "../components/common/MovieLoader";
import { QualityWarningModal } from "../components/common/QualityWarningModal";
import { getRandomCinemaInsight } from "../constants/cinemaInsights";
import { useRecentlyWatched } from "../hooks/useRecentlyWatched";

import { HomeStackParamList } from "../navigation/types";
import { useTheme } from "styled-components/native";
import Reanimated, {
  FadeIn
} from "react-native-reanimated";
import { resolveHdFilmRuntimeStream, resolveWebPlayerUrl, type WebPlayerResult } from "../services/WebPlayerService";
import { setPlayerActive } from "../services/playerActivityFlag";
import { getProviderConfig } from "../services/providerConfigService";
import { useAppSettings } from "../settings/AppSettingsContext";
import {
  normalizeSubtitleUrl,
  parseSubtitleDocument,
  type ParsedSubtitleCue
} from "../utils/subtitles";
import {
  shouldAcceptDiscoveredHdFilmStream,
  shouldAllowPlayerWebViewRequest,
} from "./player/playerWebViewPolicy";
import {
  PLAYER_STOP_MEDIA_SCRIPT,
  PLAYER_WEBVIEW_USER_AGENT,
  getEmbedInjectAfter,
  getEmbedInjectBefore,
  getInjectAfter,
  getInjectBefore,
  type WebViewProviderSource,
} from "./player/webviewInjection";

function debugLog(...args: unknown[]) {
  if (__DEV__) {
    console.log(...args);
  }
}


type PlayerScreenProps = NativeStackScreenProps<HomeStackParamList, "Player">;

type DirectSubtitleOption = {
  url: string;
  label: string;
  lang: string;
};

function getSubtitleTrackLabel(track: SubtitleTrack): string {
  const label = track.label?.trim();
  if (label) return label;

  const language = track.language?.trim();
  if (language) return language.toUpperCase();

  return "Subtitle";
}

// Subtitle parsing helpers moved to src/utils/subtitles.ts.


// ---------------------------------------------------------------------------
// Loading overlay with cinema facts
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000"
  },
  webView: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000"
  },
  nativePlayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000"
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
    zIndex: 10,
    paddingHorizontal: 36
  },
  loaderContent: {
    alignItems: "center"
  },
  loaderTitle: {
    marginTop: 16,
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: 0.2,
    textAlign: "center"
  },
  factContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 40,
    maxWidth: 300
  },
  factAccent: {
    width: 2.5,
    borderRadius: 2,
    marginRight: 14,
    opacity: 0.6
  },
  factBody: {
    flex: 1
  },
  factLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
    opacity: 0.7
  },
  factText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13.5,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: "400"
  },
  loaderText: {
    marginTop: 14,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    letterSpacing: 0.2
  },
  closeButton: {
    position: "absolute",
    top: 14,
    right: 16,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center"
  },
  scalingButton: {
    position: "absolute",
    top: 14,
    right: 62,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center"
  },
  ccButton: {
    position: "absolute",
    top: 14,
    right: 108,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center"
  },
  closeButtonInner: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center"
  },
  controlButtonDisabled: {
    opacity: 0.45
  },
  subtitleMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
    backgroundColor: "rgba(0,0,0,0.28)"
  },
  subtitleMenu: {
    position: "absolute",
    right: 14,
    top: 58,
    zIndex: 110,
    minWidth: 180,
    maxWidth: 240,
    borderRadius: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(14,14,18,0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)"
  },
  subtitleMenuHeader: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  subtitleMenuItem: {
    minHeight: 42,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  subtitleMenuItemActive: {
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  subtitleMenuItemLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
    paddingRight: 10
  },
  subtitleMenuItemMeta: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase"
  },
  subtitleMenuItemTrailing: {
    flexDirection: "row",
    alignItems: "center"
  },
  subtitleMenuCheck: {
    marginLeft: 10
  },
  subtitleOverlay: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 28,
    zIndex: 95,
    alignItems: "center"
  },
  subtitleOverlayBubble: {
    maxWidth: "92%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "transparent"
  },
  subtitleOverlayText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
    zIndex: 100
  },
  errorIcon: {
    marginBottom: 16
  },
  errorTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 8
  },
  errorText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 32
  },
  retryButton: {
    marginTop: 18,
    paddingHorizontal: 28,
    paddingVertical: 11,
    backgroundColor: "#FF4D00",
    borderRadius: 8
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700"
  },
  notAvailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0A0F",
    zIndex: 20,
    paddingHorizontal: 40
  },
  notAvailableEmoji: {
    fontSize: 64,
    marginBottom: 20
  },
  notAvailableTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 12
  },
  notAvailableSubtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8
  },
  notAvailableHint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 28
  },
  goBackButton: {
    paddingHorizontal: 36,
    paddingVertical: 13,
    backgroundColor: "#FF4D00",
    borderRadius: 12,
    shadowColor: "#FF4D00",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8
  },
  goBackText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.3
  }
});

function PlayerLoadingOverlay({
  title,
  seasonNumber,
  episodeNumber
}: {
  title: string;
  seasonNumber?: number;
  episodeNumber?: number
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { language } = useAppSettings();
  const [showFact, setShowFact] = useState(false);
  const [fact] = useState(() => getRandomCinemaInsight(language));

  useEffect(() => {
    const timer = setTimeout(() => setShowFact(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.loaderOverlay}>
      <View style={styles.loaderContent}>
        <MovieLoader size={44} />
        <Reanimated.View entering={FadeIn.duration(400)}>
          <Text style={styles.loaderTitle}>
            {title}{seasonNumber != null && episodeNumber != null ? ` S${seasonNumber} E${episodeNumber}` : ""}
          </Text>
        </Reanimated.View>
      </View>

      {showFact && (
        <Reanimated.View entering={FadeIn.duration(800).delay(100)} style={styles.factContainer}>
          <View style={[styles.factAccent, { backgroundColor: theme.colors.primary }]} />
          <View style={styles.factBody}>
            <Text style={[styles.factLabel, { color: theme.colors.primary }]}>{t("player.didYouKnow")}</Text>
            <Text style={styles.factText}>{fact}</Text>
          </View>
        </Reanimated.View>
      )}
    </View>
  );
}


// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export function PlayerScreen({ route, navigation }: PlayerScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const webViewRef = useRef<WebView>(null);
  const [playerResult, setPlayerResult] = useState<WebPlayerResult | null>(null);
  const [isResolving, setIsResolving] = useState(true);
  const [qualityWarning, setQualityWarning] = useState<{ label: string; result: WebPlayerResult } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaybackReady, setIsPlaybackReady] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [videoFit, setVideoFit] = useState<'contain' | 'cover'>('contain');
  const [availableSubtitleTracks, setAvailableSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<SubtitleTrack | null>(null);
  const [isSubtitleMenuOpen, setIsSubtitleMenuOpen] = useState(false);
  const [selectedExternalSubtitle, setSelectedExternalSubtitle] = useState<DirectSubtitleOption | null>(null);
  const [externalSubtitleCues, setExternalSubtitleCues] = useState<ParsedSubtitleCue[]>([]);
  const [activeSubtitleText, setActiveSubtitleText] = useState<string | null>(null);

  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);

  // â”€â”€ Track recent playback entry only â”€â”€
  const { addToRecentlyWatched } = useRecentlyWatched();
  const hasTrackedRef = useRef(false);
  const hdfilmNativeFallbackTriggeredRef = useRef(false);
  const hdfilmRuntimeDiscoveryKeysRef = useRef(new Set<string>());
  const playerResultRef = useRef<WebPlayerResult | null>(null);

  useEffect(() => {
    playerResultRef.current = playerResult;
  }, [playerResult]);

  // Block silent OTA reload while this screen is mounted — otherwise the user
  // returning to the app after a brief lock-screen would lose their playback
  // position to a forced JS reload.
  useEffect(() => {
    setPlayerActive(true);
    return () => setPlayerActive(false);
  }, []);

  useEffect(() => {
    return () => {
      const currentWebView = webViewRef.current as unknown as {
        injectJavaScript?: (script: string) => void;
        stopLoading?: () => void;
        clearCache?: (includeDiskFiles: boolean) => void;
        clearHistory?: () => void;
      } | null;

      currentWebView?.injectJavaScript?.(PLAYER_STOP_MEDIA_SCRIPT);
      currentWebView?.stopLoading?.();
      currentWebView?.clearHistory?.();
      currentWebView?.clearCache?.(true);
    };
  }, []);

  useEffect(() => {
    if (!hasTrackedRef.current && !route.params.trailerUrl) {
      hasTrackedRef.current = true;
      void addToRecentlyWatched(Number(route.params.tmdbId), route.params.mediaType, {
        title: route.params.title,
        imdbId: route.params.imdbId ?? null,
      });
    }
  }, [addToRecentlyWatched, route.params.tmdbId, route.params.mediaType, route.params.trailerUrl]);

  // â”€â”€ Auto-hide overlay controls â”€â”€
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsVisibleRef = useRef(true);
  const AUTO_HIDE_MS = 5000;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideControlsNow = useCallback(() => {
    clearHideTimer();
    controlsVisibleRef.current = false;
    controlsOpacity.stopAnimation();
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true
    }).start(() => {
      if (!controlsVisibleRef.current) {
        setControlsVisible(false);
      }
    });
  }, [controlsOpacity, clearHideTimer]);

  const scheduleHideControls = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(hideControlsNow, AUTO_HIDE_MS);
  }, [clearHideTimer, hideControlsNow]);

  const showControls = useCallback(() => {
    clearHideTimer();
    controlsVisibleRef.current = true;
    controlsOpacity.stopAnimation();
    setControlsVisible(true);
    controlsOpacity.setValue(1);
    scheduleHideControls();
  }, [controlsOpacity, clearHideTimer, scheduleHideControls]);

  const toggleControls = useCallback(() => {
    if (isSubtitleMenuOpen || isQualityMenuOpen) return;
    if (controlsVisibleRef.current) {
      hideControlsNow();
    } else {
      showControls();
    }
  }, [isSubtitleMenuOpen, isQualityMenuOpen, showControls, hideControlsNow]);

  // Legacy alias so the WebView path keeps working without renaming everything
  const showCloseBtn = controlsVisible;
  const closeBtnOpacity = controlsOpacity;
  const scheduleHideClose = scheduleHideControls;

  const toggleVideoFit = useCallback(() => {
    const nextFit = videoFit === 'contain' ? 'cover' : 'contain';
    setVideoFit(nextFit);

    // Safe approach: only touch inline styles on <video> elements and
    // add/update a small dedicated override <style>. Never replace textContent
    // on existing style sheets — that triggers a full CSS reparse which kills
    // JWPlayer's internal state and freezes the video.
    const js = `
      (function() {
        try {
          // 1. Set inline style on every video element (safest, no reflow)
          document.querySelectorAll('video').forEach(function(v) {
            v.style.setProperty('object-fit', '${nextFit}', 'important');
          });

          // 2. Add/update a tiny dedicated override style
          var overrideId = 'sb-fit-override';
          var existing = document.getElementById(overrideId);
          if (!existing) {
            existing = document.createElement('style');
            existing.id = overrideId;
            (document.head || document.documentElement).appendChild(existing);
          }
          existing.textContent = 'video { object-fit: ${nextFit} !important; }';

          // 3. Do the same inside iframes we can access
          document.querySelectorAll('iframe').forEach(function(frame) {
            try {
              var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
              if (!fd) return;
              fd.querySelectorAll('video').forEach(function(v) {
                v.style.setProperty('object-fit', '${nextFit}', 'important');
              });
              var fExisting = fd.getElementById(overrideId);
              if (!fExisting) {
                fExisting = fd.createElement('style');
                fExisting.id = overrideId;
                (fd.head || fd.documentElement).appendChild(fExisting);
              }
              fExisting.textContent = 'video { object-fit: ${nextFit} !important; }';
            } catch(e) {}
          });
        } catch(e) {}
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
    showControls();
  }, [videoFit, showControls]);

  const toggleCloseBtn = toggleControls;

  // Start the auto-hide timer when the player finishes loading
  useEffect(() => {
    if (!isResolving && isPlaybackReady && playerResult?.source !== "not_found") {
      scheduleHideClose();
    }
    return clearHideTimer;
  }, [isPlaybackReady, isResolving, playerResult, scheduleHideClose, clearHideTimer]);

  // Pause auto-hide while a menu is open; resume when closed
  useEffect(() => {
    if (isSubtitleMenuOpen || isQualityMenuOpen) {
      clearHideTimer();
    } else if (controlsVisibleRef.current) {
      scheduleHideControls();
    }
  }, [isSubtitleMenuOpen, isQualityMenuOpen, clearHideTimer, scheduleHideControls]);

  // Step 1: Resolve the movie page URL (or use trailer)
  useEffect(() => {
    let cancelled = false;

    setLoadError(null);
    setIsPlaybackReady(false);
    setAvailableSubtitleTracks([]);
    setSelectedSubtitleTrack(null);
    setIsSubtitleMenuOpen(false);
    setSelectedExternalSubtitle(null);
    setExternalSubtitleCues([]);
    setActiveSubtitleText(null);
    hdfilmNativeFallbackTriggeredRef.current = false;
    hdfilmRuntimeDiscoveryKeysRef.current.clear();

    if (route.params.trailerUrl) {
      // Show trailer directly
      setIsResolving(false);
      const match = route.params.trailerUrl.match(/[?&]v=([^&]+)/);
      const videoId = match ? match[1] : null;

      if (videoId) {
        setPlayerResult({
          url: videoId,
          source: "youtube_embed"
        });
      } else {
        setPlayerResult({ url: route.params.trailerUrl, source: "hdfilm" });
      }
      setCurrentStreamUrl(null);
      return;
    }

    setIsResolving(true);
    resolveWebPlayerUrl({
      mediaType: route.params.mediaType,
      title: route.params.title,
      originalTitle: route.params.originalTitle,
      tmdbId: route.params.tmdbId,
      imdbId: route.params.imdbId,
      year: route.params.year,
      seasonNumber: route.params.seasonNumber,
      episodeNumber: route.params.episodeNumber,
      castNames: route.params.castNames,
      videoId: route.params.videoId
    })
      .then((result) => {
        if (cancelled) return;
        debugLog("[Player] URL:", result.url, "source:", result.source, "streamUrl:", result.streamUrl ?? "none", "streamType:", result.streamType ?? "none");

        if (result.qualityWarning && result.source !== "not_found") {
          setIsResolving(false);
          setQualityWarning({ label: result.qualityWarning, result });
        } else {
          setPlayerResult(result);
          setCurrentStreamUrl(result.streamUrl ?? null);
          setIsResolving(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerResult({ url: "", source: "not_found" });
          setIsResolving(false);
        }
      });

    return () => { cancelled = true; };
  }, [route.params]);

  // Landscape lock â€” only when movie is actually available
  useEffect(() => {
    if (!playerResult || playerResult.source === "not_found") return;

    StatusBar.setHidden(true, "fade");

    if (playerResult.source !== "youtube_embed") {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }

    return () => {
      StatusBar.setHidden(false, "fade");
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, [playerResult]);

  // Safety net: bound how long the loader can sit on top of a WebView. The
  // injected JS posts `player_ready` once JWPlayer initialises — but if the
  // provider's Cloudflare challenge stalls or JWPlayer never starts, that
  // message never arrives and the loader sits indefinitely over a
  // page-loaded WebView. After this many ms with no player_ready, hide the
  // loader anyway; the WebView is already rendered behind it so the user
  // sees the provider's own UI immediately.
  useEffect(() => {
    if (!playerResult) return;
    const source = playerResult.source;
    const isWebViewPlayback = source === "hdfilm" || source === "dizipal" || source === "dizipal_embed";
    if (!isWebViewPlayback) return;
    if (isPlaybackReady) return;
    const timer = setTimeout(() => {
      setIsPlaybackReady(true);
    }, 25_000);
    return () => clearTimeout(timer);
  }, [playerResult, isPlaybackReady]);

  const handleFullScreenChange = useCallback((isFullScreen: boolean) => {
    if (isFullScreen) {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
  }, []);

  // Android back
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack && webViewRef.current) { webViewRef.current.goBack(); return true; }
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const handleClose = useCallback(() => {
    webViewRef.current?.injectJavaScript(PLAYER_STOP_MEDIA_SCRIPT);
    webViewRef.current?.stopLoading();
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    navigation.goBack();
  }, [navigation]);

  const handleNavChange = useCallback((s: WebViewNavigation) => {
    setCanGoBack(s.canGoBack);

    if (playerResult?.url && s.url && !shouldAllowPlayerWebViewRequest({ url: s.url, isTopFrame: true }, playerResult.url)) {
      webViewRef.current?.injectJavaScript(PLAYER_STOP_MEDIA_SCRIPT);
      webViewRef.current?.stopLoading();
    }
  }, [playerResult?.url]);
  const handlePlaybackReady = useCallback(() => {
    setIsPlaybackReady(true);
  }, []);

  const switchToHdFilmNativeFallback = useCallback((reason: string) => {
    setPlayerResult((current) => {
      if (
        !current ||
        current.source !== "hdfilm" ||
        !current.streamUrl ||
        hdfilmNativeFallbackTriggeredRef.current
      ) {
        return current;
      }

      hdfilmNativeFallbackTriggeredRef.current = true;
      debugLog("[Player] Switching HDFilm to native fallback:", reason, current.streamUrl);
      webViewRef.current?.injectJavaScript(PLAYER_STOP_MEDIA_SCRIPT);
      webViewRef.current?.stopLoading();
      setLoadError(null);
      setIsPlaybackReady(false);
      setCurrentStreamUrl(current.streamUrl);
      setSelectedSubtitleTrack(null);
      setSelectedExternalSubtitle(null);
      setExternalSubtitleCues([]);
      setActiveSubtitleText(null);

      return {
        ...current,
        url: current.streamUrl,
        source: "direct",
        streamUrl: current.streamUrl,
        streamType: current.streamType ?? "m3u8",
        referer: current.referer || current.embedUrl || current.url,
        embedUrl: current.embedUrl || current.referer || current.url
      };
    });
  }, []);

  const switchToDiscoveredHdFilmStream = useCallback((result: WebPlayerResult, reason: string) => {
    setPlayerResult((current) => {
      if (
        !current ||
        current.source !== "hdfilm" ||
        !result.streamUrl ||
        hdfilmNativeFallbackTriggeredRef.current
      ) {
        return current;
      }

      hdfilmNativeFallbackTriggeredRef.current = true;
      debugLog("[Player] Switching HDFilm runtime stream to native:", reason, result.streamUrl);
      webViewRef.current?.injectJavaScript(PLAYER_STOP_MEDIA_SCRIPT);
      webViewRef.current?.stopLoading();
      setLoadError(null);
      setIsPlaybackReady(false);
      setCurrentStreamUrl(result.streamUrl);
      setSelectedSubtitleTrack(null);
      setSelectedExternalSubtitle(null);
      setExternalSubtitleCues([]);
      setActiveSubtitleText(null);

      return {
        ...current,
        ...result,
        url: result.streamUrl,
        source: "direct",
        streamUrl: result.streamUrl,
        streamType: result.streamType ?? (result.streamUrl.toLowerCase().includes(".m3u8") ? "m3u8" : "mp4"),
        referer: result.referer || result.embedUrl || current.url,
        embedUrl: result.embedUrl || result.referer || current.url,
        subtitles: result.subtitles ?? []
      };
    });
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload?.type === "hdfilm_stream_discovered") {
        if (playerResultRef.current?.source !== "hdfilm") return;

        const streamUrl = typeof payload.streamUrl === "string" ? payload.streamUrl : "";
        if (!streamUrl) return;
        const referer =
          typeof payload.referer === "string"
            ? payload.referer
            : playerResultRef.current?.url ?? "";
        const embedUrl =
          typeof payload.embedUrl === "string"
            ? payload.embedUrl
            : referer || (playerResultRef.current?.url ?? "");

        if (!shouldAcceptDiscoveredHdFilmStream(streamUrl, referer, embedUrl)) {
          return;
        }

        const key = `stream:${streamUrl}`;
        if (hdfilmRuntimeDiscoveryKeysRef.current.has(key)) return;
        hdfilmRuntimeDiscoveryKeysRef.current.add(key);

        switchToDiscoveredHdFilmStream({
          url: streamUrl,
          source: "direct",
          streamUrl,
          streamType:
            typeof payload.streamType === "string"
              ? payload.streamType
              : streamUrl.toLowerCase().includes(".m3u8")
                ? "m3u8"
                : "mp4",
          referer,
          embedUrl,
          subtitles: []
        }, String(payload.source ?? "runtime-stream"));
        return;
      }

      if (payload?.type === "hdfilm_embed_discovered") {
        if (playerResultRef.current?.source !== "hdfilm") return;

        const embedUrl = typeof payload.embedUrl === "string" ? payload.embedUrl : "";
        if (!embedUrl) return;

        const key = `embed:${embedUrl}`;
        if (hdfilmRuntimeDiscoveryKeysRef.current.has(key)) return;
        hdfilmRuntimeDiscoveryKeysRef.current.add(key);

        const currentPageUrl =
          playerResultRef.current?.url ??
          (typeof payload.pageUrl === "string" ? payload.pageUrl : "");

        void resolveHdFilmRuntimeStream(embedUrl, currentPageUrl)
          .then((result) => {
            if (
              result?.streamUrl &&
              shouldAcceptDiscoveredHdFilmStream(result.streamUrl, result.referer, result.embedUrl)
            ) {
              switchToDiscoveredHdFilmStream(result, String(payload.source ?? "runtime-embed"));
            }
          })
          .catch(() => {
            // Runtime discovery is best-effort; keep the provider player alive if embed resolution fails.
          });
        return;
      }

      if (payload?.type === "player_ready") {
        setLoadError(null);
        setIsPlaybackReady(true);
        return;
      }
      if (payload?.type === "player_tap") {
        showControls();
        return;
      }
      if (payload?.type === "player_black_screen_suspected") {
        switchToHdFilmNativeFallback(String(payload.reason ?? "visual-frame-timeout"));
        return;
      }
      if (payload?.type === "player_controls_hidden") return;
      if (payload?.type === "player_not_found") {
        setLoadError(null);
        setIsPlaybackReady(false);
        setPlayerResult({ url: "", source: "not_found" });
      }
    } catch {
      // Ignore unrelated WebView messages.
    }
  }, [showControls, switchToDiscoveredHdFilmStream, switchToHdFilmNativeFallback]);
  const handleError = useCallback(() => {
    setIsPlaybackReady(false);
    setLoadError("Failed to load. Please check your connection.");
  }, []);

  // Native video player for direct streams
  const directStreamUrl = (playerResult?.source === "dizipal_direct" || playerResult?.source === "direct") 
    ? (currentStreamUrl || playerResult.streamUrl || null) 
    : null;
  const videoPlayer = useVideoPlayer(null as string | null, (player: any) => {
    player.loop = false;
  });

  // Load the source when directStreamUrl becomes available
  const streamReferer = (playerResult?.source === "dizipal_direct" || playerResult?.source === "direct") ? playerResult.referer ?? "" : "";
  const directStreamType = (playerResult?.source === "dizipal_direct" || playerResult?.source === "direct") ? playerResult.streamType ?? "" : "";
  const directEmbedUrl = (playerResult?.source === "dizipal_direct" || playerResult?.source === "direct") ? playerResult.embedUrl ?? "" : "";
  const directSubtitleOptions =
    (playerResult?.source === "dizipal_direct" || playerResult?.source === "direct")
      ? (playerResult.subtitles ?? [])
          .filter(s => !s.url.includes(".m3u8")) // Skip HLS subtitle playlists for external side-loading
          .map((subtitle) => ({
            ...subtitle,
            url: normalizeSubtitleUrl(
              subtitle.url,
              directEmbedUrl,
              playerResult.url,
              streamReferer,
              directStreamUrl
            )
          }))
      : [];
  useEffect(() => {
    if (!videoPlayer || !directStreamUrl) return;

    debugLog("[Player] Loading direct stream:", directStreamUrl, "referer:", streamReferer);
    const contentType: ContentType | undefined = directStreamType === "m3u8" ? "hls" : undefined;
    const source = {
      uri: directStreamUrl,
      headers: {
        ...(streamReferer ? { Referer: streamReferer } : {}),
        ...(streamReferer ? { Origin: new URL(streamReferer).origin } : {}),
        "User-Agent": PLAYER_WEBVIEW_USER_AGENT
      },
      contentType
    };
    void videoPlayer.replaceAsync(source);
    // Don't call play() here â€” wait for readyToPlay status so play() doesn't silently fail
  }, [videoPlayer, directStreamUrl, streamReferer, directStreamType]);

  useEffect(() => {
    if (!videoPlayer) return;

    let hasStarted = false;

    const statusSub = videoPlayer.addListener("statusChange", (ev: any) => {
      if (ev.status === "readyToPlay" && !hasStarted) {
        hasStarted = true;
        debugLog("[Player] Ready - starting playback");
        debugLog("[Player] Available subtitle tracks:", JSON.stringify(videoPlayer.availableSubtitleTracks));
        setAvailableSubtitleTracks(videoPlayer.availableSubtitleTracks);
        setSelectedSubtitleTrack(videoPlayer.subtitleTrack ?? null);
        videoPlayer.play();
        setIsPlaybackReady(true);
      }
      if (ev.status === "error") {
        debugLog("[Player] Video error:", ev.error?.message);
        setIsPlaybackReady(false);
        setPlayerResult((prev) => {
          if (prev?.source === "dizipal_direct") {
            setLoadError(null);
            return { url: prev.url, source: "dizipal" };
          }
          // HDFilm-derived direct streams carry the original page URL so we can
          // gracefully drop to the on-page JWPlayer if the native stream fails
          // (broken segment, expired token, geo block, etc.).
          if (prev?.source === "direct" && prev.webViewFallbackUrl) {
            debugLog("[Player] Direct stream failed; falling back to HDFilm WebView:", prev.webViewFallbackUrl);
            setLoadError(null);
            return { url: prev.webViewFallbackUrl, source: "hdfilm" };
          }
          setLoadError("Failed to load this stream. Please try again later.");
          return prev;
        });
      }
    });

    const playingSub = videoPlayer.addListener("playingChange", (ev: any) => {
      if (ev.isPlaying && !hasStarted) {
        hasStarted = true;
        setIsPlaybackReady(true);
      }
    });

    const subtitleSub = videoPlayer.addListener("availableSubtitleTracksChange", (ev: any) => {
      debugLog("[Player] Subtitle tracks available:", JSON.stringify(ev.availableSubtitleTracks));
      setAvailableSubtitleTracks(ev.availableSubtitleTracks);
    });

    const subtitleTrackSub = videoPlayer.addListener("subtitleTrackChange", (ev: any) => {
      setSelectedSubtitleTrack(ev.subtitleTrack ?? null);
    });

    return () => {
      statusSub.remove();
      playingSub.remove();
      subtitleSub.remove();
      subtitleTrackSub.remove();
    };
  }, [videoPlayer]);

  useEffect(() => {
    if (!selectedExternalSubtitle || selectedExternalSubtitle.url.includes(".m3u8")) {
      setExternalSubtitleCues([]);
      setActiveSubtitleText(null);
      return;
    }

    let cancelled = false;

    const subtitleReferer = directEmbedUrl || streamReferer;
    const subtitleOrigin = subtitleReferer
      ? (() => {
          try {
            return new URL(subtitleReferer).origin;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    const headers = {
      Accept: "text/vtt,text/plain,application/x-subrip,*/*",
      "User-Agent": PLAYER_WEBVIEW_USER_AGENT,
      ...(subtitleReferer ? { Referer: subtitleReferer } : {}),
      ...(subtitleOrigin ? { Origin: subtitleOrigin } : {})
    };

    axios
      .get<string>(selectedExternalSubtitle.url, {
        timeout: 10000,
        responseType: "text",
        headers,
        transformResponse: [(data) => (typeof data === "string" ? data : String(data ?? ""))]
      })
      .then((response) => {
        if (cancelled) return;
        debugLog(
          "[Player] Subtitle response preview:",
          response.data.slice(0, 200).replace(/\s+/g, " ")
        );
        const cues = parseSubtitleDocument(response.data);
        debugLog("[Player] Parsed external subtitles:", selectedExternalSubtitle.label, cues.length);
        if (cues.length === 0) {
          // Log raw bytes to debug encoding issues
          const rawChars = response.data.slice(0, 60);
          debugLog("[Player] Subtitle raw char codes:", Array.from(rawChars).map((c: string) => c.charCodeAt(0)).join(","));
        }
        setExternalSubtitleCues(cues);
      })
      .catch((error) => {
        if (cancelled) return;
        debugLog("[Player] Failed to load external subtitles:", selectedExternalSubtitle.url, error?.message ?? String(error));
        setExternalSubtitleCues([]);
        setActiveSubtitleText(null);
      });

    return () => {
      cancelled = true;
    };
  }, [directEmbedUrl, selectedExternalSubtitle, streamReferer]);

  useEffect(() => {
    if (!videoPlayer || !selectedExternalSubtitle) {
      setActiveSubtitleText(null);
      return;
    }

    const syncSubtitle = (currentTime: number) => {
      if (externalSubtitleCues.length === 0) {
        setActiveSubtitleText(null);
        return;
      }

      const cue = externalSubtitleCues.find((item) => currentTime >= item.start && currentTime <= item.end);
      setActiveSubtitleText(cue?.text ?? null);
    };

    syncSubtitle(videoPlayer.currentTime ?? 0);
    const intervalId = setInterval(() => {
      syncSubtitle(videoPlayer.currentTime ?? 0);
    }, 250);

    return () => {
      clearInterval(intervalId);
      setActiveSubtitleText(null);
    };
  }, [videoPlayer, selectedExternalSubtitle, externalSubtitleCues]);

  useEffect(() => {
    if (playerResult?.source !== "dizipal_direct" && playerResult?.source !== "direct") {
      setIsSubtitleMenuOpen(false);
      setIsQualityMenuOpen(false);
    }
  }, [playerResult?.source]);

  const toggleQualityMenu = useCallback(() => {
    if (!playerResult?.qualityOptions?.length) return;
    setIsQualityMenuOpen((curr) => {
      if (!curr) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else {
        scheduleHideClose();
      }
      return !curr;
    });
    setIsSubtitleMenuOpen(false);
  }, [playerResult?.qualityOptions, scheduleHideClose]);

  const selectQuality = useCallback((url: string) => {
    if (url === currentStreamUrl) return;
    const currentTime = videoPlayer.currentTime;
    setCurrentStreamUrl(url);
    setIsQualityMenuOpen(false);
    scheduleHideClose();
    videoPlayer.replaceAsync({
      uri: url,
      headers: streamReferer ? { Referer: streamReferer } : undefined,
      contentType: directStreamType === "m3u8" ? "hls" : undefined
    }).then(() => {
      videoPlayer.currentTime = currentTime;
      videoPlayer.play();
    });
  }, [videoPlayer, currentStreamUrl, streamReferer, directStreamType]);

  const toggleDirectSubtitleMenu = useCallback(() => {
    if (directSubtitleOptions.length === 0 && availableSubtitleTracks.length === 0) return;
    setIsSubtitleMenuOpen((current) => {
      if (!current) {
        // Opening menu — pause auto-hide
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else {
        // Closing menu — restart auto-hide
        scheduleHideClose();
      }
      return !current;
    });
    setIsQualityMenuOpen(false);
  }, [directSubtitleOptions.length, availableSubtitleTracks.length, scheduleHideClose]);

  const selectSubtitleTrack = useCallback((track: SubtitleTrack | null) => {
    videoPlayer.subtitleTrack = track;
    setSelectedSubtitleTrack(track);
    setSelectedExternalSubtitle(null);
    setExternalSubtitleCues([]);
    setActiveSubtitleText(null);
    setIsSubtitleMenuOpen(false);
    scheduleHideClose();
  }, [videoPlayer, scheduleHideClose]);

  const selectExternalSubtitle = useCallback((subtitle: DirectSubtitleOption | null) => {
    videoPlayer.subtitleTrack = null;
    setSelectedSubtitleTrack(null);
    setSelectedExternalSubtitle(subtitle);
    setExternalSubtitleCues([]);
    setActiveSubtitleText(null);
    setIsSubtitleMenuOpen(false);
    scheduleHideClose();
  }, [videoPlayer, scheduleHideClose]);

  const isLoading = isResolving || (!isPlaybackReady && playerResult?.source !== "not_found");
  const isNotAvailable = playerResult?.source === "not_found";

  const isDirectStream = playerResult?.source === "dizipal_direct" || playerResult?.source === "direct";

  // Direct stream: completely isolated render tree
  if (isDirectStream && directStreamUrl) {
    return (
      <View style={styles.root}>
        <VideoView
          player={videoPlayer}
          style={styles.nativePlayer}
          contentFit={videoFit}
          nativeControls
          surfaceType="textureView"
          onTouchEnd={toggleCloseBtn}
        />
        {isLoading && (
          <PlayerLoadingOverlay
            title={route.params.title}
            seasonNumber={route.params.seasonNumber}
            episodeNumber={route.params.episodeNumber}
          />
        )}
        {!isLoading && isSubtitleMenuOpen && (
          <Pressable style={styles.subtitleMenuBackdrop} onPress={() => setIsSubtitleMenuOpen(false)} />
        )}
        {!isLoading && showCloseBtn && (
          <>
            <Animated.View style={[styles.closeButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.closeButtonInner} accessibilityRole="button" accessibilityLabel={t("player.a11y.close")}>
                <Feather name="x" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={[styles.scalingButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity onPress={toggleVideoFit} activeOpacity={0.8} style={styles.closeButtonInner} accessibilityRole="button" accessibilityLabel={t("player.a11y.toggleFit")}>
                <Feather name={videoFit === "contain" ? "maximize" : "minimize"} size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={[styles.ccButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity
                onPress={toggleDirectSubtitleMenu}
                activeOpacity={directSubtitleOptions.length > 0 || availableSubtitleTracks.length > 0 ? 0.8 : 1}
                accessibilityRole="button"
                accessibilityLabel={t("player.a11y.subtitles")}
                accessibilityState={{ disabled: directSubtitleOptions.length === 0 && availableSubtitleTracks.length === 0 }}
                style={[
                  styles.closeButtonInner,
                  directSubtitleOptions.length === 0 &&
                  availableSubtitleTracks.length === 0 &&
                  styles.controlButtonDisabled
                ]}
              >
                <MaterialIcons name="closed-caption" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>

            {playerResult?.qualityOptions && playerResult.qualityOptions.length > 1 && (
              <Animated.View style={[styles.ccButton, { right: 154, opacity: closeBtnOpacity }]}>
                <TouchableOpacity
                  onPress={toggleQualityMenu}
                  activeOpacity={0.8}
                  style={styles.closeButtonInner}
                  accessibilityRole="button"
                  accessibilityLabel={t("player.a11y.quality")}
                >
                  <MaterialIcons name="settings" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </Animated.View>
            )}

            {(isSubtitleMenuOpen || isQualityMenuOpen) && (
              <View style={styles.subtitleMenu}>
                {isSubtitleMenuOpen && (
                  <>
                    <Text style={styles.subtitleMenuHeader}>Subtitles</Text>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={[
                        styles.subtitleMenuItem,
                        selectedExternalSubtitle == null && selectedSubtitleTrack == null && styles.subtitleMenuItemActive
                      ]}
                      onPress={() => {
                        if (directSubtitleOptions.length > 0) {
                          selectExternalSubtitle(null);
                        } else {
                          selectSubtitleTrack(null);
                        }
                      }}
                    >
                      <Text style={styles.subtitleMenuItemLabel}>Off</Text>
                      {selectedExternalSubtitle == null && selectedSubtitleTrack == null && (
                        <Feather name="check" size={15} color="#FFFFFF" />
                      )}
                    </TouchableOpacity>
                    {directSubtitleOptions.length > 0
                      ? directSubtitleOptions.map((subtitle) => {
                          const isActive = selectedExternalSubtitle?.url === subtitle.url;

                          return (
                            <TouchableOpacity
                              key={subtitle.url}
                              activeOpacity={0.8}
                              style={[styles.subtitleMenuItem, isActive && styles.subtitleMenuItemActive]}
                              onPress={() => selectExternalSubtitle(subtitle)}
                            >
                              <Text style={styles.subtitleMenuItemLabel}>{subtitle.label}</Text>
                              <View style={styles.subtitleMenuItemTrailing}>
                                <Text style={styles.subtitleMenuItemMeta}>{subtitle.lang || "SUB"}</Text>
                                {isActive && (
                                  <Feather name="check" size={15} color="#FFFFFF" style={styles.subtitleMenuCheck} />
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      : availableSubtitleTracks.map((track) => {
                          const isActive = selectedSubtitleTrack?.id === track.id;

                          return (
                            <TouchableOpacity
                              key={track.id}
                              activeOpacity={0.8}
                              style={[styles.subtitleMenuItem, isActive && styles.subtitleMenuItemActive]}
                              onPress={() => selectSubtitleTrack(track)}
                            >
                              <Text style={styles.subtitleMenuItemLabel}>{getSubtitleTrackLabel(track)}</Text>
                              <View style={styles.subtitleMenuItemTrailing}>
                                <Text style={styles.subtitleMenuItemMeta}>{track.language || "SUB"}</Text>
                                {isActive && (
                                  <Feather name="check" size={15} color="#FFFFFF" style={styles.subtitleMenuCheck} />
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                  </>
                )}

                {isQualityMenuOpen && playerResult?.qualityOptions && (
                  <>
                    <Text style={styles.subtitleMenuHeader}>Quality</Text>
                    {playerResult.qualityOptions.map((option) => {
                      const isActive = option.url === currentStreamUrl;
                      return (
                        <TouchableOpacity
                          key={option.url}
                          activeOpacity={0.8}
                          style={[styles.subtitleMenuItem, isActive && styles.subtitleMenuItemActive]}
                          onPress={() => selectQuality(option.url)}
                        >
                          <Text style={styles.subtitleMenuItemLabel}>{option.label}</Text>
                          {isActive && (
                            <Feather name="check" size={15} color="#FFFFFF" />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </View>
            )}

          </>
        )}
        {!isLoading && activeSubtitleText && (
          <View pointerEvents="none" style={styles.subtitleOverlay}>
            <View style={styles.subtitleOverlayBubble}>
              <Text style={styles.subtitleOverlayText}>{activeSubtitleText}</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Close â€” auto-hides after 3s, tap screen to toggle */}
      {showCloseBtn && (
        <>
          <Animated.View style={[styles.closeButton, { opacity: closeBtnOpacity }]}>
            <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.closeButtonInner} accessibilityRole="button" accessibilityLabel={t("player.a11y.close")}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>

          {(playerResult?.source === 'hdfilm' || playerResult?.source === 'dizipal' || playerResult?.source === 'dizipal_embed') && (
            <Animated.View style={[styles.scalingButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity onPress={toggleVideoFit} activeOpacity={0.8} style={styles.closeButtonInner} accessibilityRole="button" accessibilityLabel={t("player.a11y.toggleFit")}>
                <Feather name={videoFit === 'contain' ? 'maximize' : 'minimize'} size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>
          )}
        </>
      )}

      {/* Loading overlay with facts */}
      {isLoading && (
        <PlayerLoadingOverlay
          title={route.params.title}
          seasonNumber={route.params.seasonNumber}
          episodeNumber={route.params.episodeNumber}
        />
      )}

      {/* Error */}
      {loadError && !isLoading && (
        <View style={styles.loaderOverlay}>
          <Text style={styles.errorTitle}>Playback Error</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} accessibilityRole="button" accessibilityLabel={t("player.a11y.retry")} onPress={() => {
            setLoadError(null);
            setIsPlaybackReady(false);
            webViewRef.current?.reload();
          }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Not Available */}
      {isNotAvailable && !isResolving && (
        <View style={styles.notAvailableOverlay}>
          <Text style={styles.notAvailableEmoji}>🎬</Text>
          <Text style={styles.notAvailableTitle}>Not Available Yet</Text>
          <Text style={styles.notAvailableSubtitle}>
            Sorry, "{route.params.title}" is not available in our movie catalog yet.
          </Text>
          <Text style={styles.notAvailableHint}>
            We're always adding new content. Please check back later!
          </Text>
          <TouchableOpacity style={[styles.goBackButton, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.primary }]} onPress={handleClose} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t("common.goBack")}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* YouTube Native Player for trailers */}
      {playerResult && playerResult.source === "youtube_embed" && (
        <View style={[styles.webView, { justifyContent: "center" }]}>
          <YoutubeIframe
            height={windowHeight > windowWidth ? windowWidth * (9 / 16) : windowHeight}
            width={windowWidth}
            videoId={playerResult.url}
            play={true}
            onReady={handlePlaybackReady}
            onError={handleError}
            onFullScreenChange={handleFullScreenChange}
            initialPlayerParams={{
              preventFullScreen: false,
              controls: true,
              modestbranding: true,
              rel: false
            }}
          />
        </View>
      )}

      {/* WebView for Dizipal embed (direct embed URL â€” full JWPlayer with subs/audio) */}
      {playerResult?.source === "dizipal_embed" && (
        <WebView
          ref={webViewRef}
          source={{ uri: playerResult.url, headers: { Referer: getProviderConfig("dizipal").referer } }}
          style={styles.webView}
          injectedJavaScriptBeforeContentLoaded={getEmbedInjectBefore(videoFit)}
          injectedJavaScript={getEmbedInjectAfter(videoFit)}
          injectedJavaScriptForMainFrameOnly={false}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          scalesPageToFit={false}
          incognito
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled
          cacheEnabled={false}
          mixedContentMode="always"
          originWhitelist={["*"]}
          userAgent={PLAYER_WEBVIEW_USER_AGENT}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          onMessage={handleMessage}
          onError={handleError}
          onNavigationStateChange={handleNavChange}
          onShouldStartLoadWithRequest={(req) => shouldAllowPlayerWebViewRequest(req, playerResult.url)}
        />
      )}

      {/* WebView for HDFilm/Dizipal page sources */}
      {playerResult && (playerResult.source === "hdfilm" || playerResult.source === "dizipal") && (
        <WebView
          ref={webViewRef}
          source={{ uri: playerResult.url }}
          style={styles.webView}
          injectedJavaScriptBeforeContentLoaded={
            playerResult.source?.includes('embed')
              ? getEmbedInjectBefore(videoFit)
              : getInjectBefore(playerResult?.source as WebViewProviderSource, videoFit)
          }
          injectedJavaScript={getInjectAfter(
            playerResult?.source as WebViewProviderSource,
            route.params.mediaType,
            videoFit,
            route.params.seasonNumber,
            route.params.episodeNumber
          )}
          injectedJavaScriptForMainFrameOnly={false}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          scalesPageToFit={false}
          incognito
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled
          cacheEnabled={false}
          mixedContentMode="always"
          originWhitelist={["*"]}
          userAgent={PLAYER_WEBVIEW_USER_AGENT}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          onMessage={handleMessage}
          onError={handleError}
          onNavigationStateChange={handleNavChange}
          onShouldStartLoadWithRequest={(req) => shouldAllowPlayerWebViewRequest(req, playerResult.url)}
        />
      )}
      <QualityWarningModal
        visible={qualityWarning !== null}
        qualityLabel={qualityWarning?.label ?? ""}
        onGoBack={() => {
          setQualityWarning(null);
          void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
          navigation.goBack();
        }}
        onContinue={() => {
          if (qualityWarning) {
            setPlayerResult(qualityWarning.result);
            setCurrentStreamUrl(qualityWarning.result.streamUrl ?? null);
          }
          setQualityWarning(null);
        }}
      />
    </View>
  );
}

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
import { resolveWebPlayerUrl, type WebPlayerResult } from "../services/WebPlayerService";
import { getProviderConfig } from "../services/providerConfigService";
import { useAppSettings } from "../settings/AppSettingsContext";

// ---------------------------------------------------------------------------
// Cinema facts shown during loading
// ---------------------------------------------------------------------------
const MOVIE_FACTS = [
  "In Interstellar, the 'mountain' waves on Miller's planet were actually created by a mechanical device in a water tank, not just CGI.",
  "The famous shower scene in Psycho took seven days to film and contains 77 different camera angles.",
  "In The Godfather, the cat Marlon Brando holds in the opening scene was a stray found in the studio and was not in the script.",
  "The Star Wars character Yoda's eyes were modeled after Albert Einstein's eyes to give him an intelligent, wise look.",
  "The gold paint on the actress in Goldfinger was genuine, and she had to be painted very quickly to avoid 'skin suffocation'.",
  "For The Revenant, Leonardo DiCaprio actually ate a raw bison liver despite being a vegetarian.",
  "The 'horses' in Monty Python and the Holy Grail were actually just coconut shells because the production couldn't afford real horses.",
  "Toy Story 2 was almost completely deleted by a computer command during production; fortunately, a technical director had a backup at home.",
  "The speed of the bus in Speed (1994) was actually 50 mph, but they filmed it from angles that made it look much faster.",
  "In Back to the Future, the time machine was originally going to be a refrigerator before they decided on a DeLorean.",
  "The movie Gravity actually had a longer production cycle than the time it took to send a man to the moon.",
  "Parasite (2019) used over 60% CGI to enhance the house architecture, although it looks like a real building.",
  "The scream in The Dark Knight during the hospital explosion was genuine; Ledger was instructed to keep walking despite the delayed blast.",
  "The Blair Witch Project actors were given less food each day of filming to increase their real-life irritability and fear.",
  "In E.T. the Extra-Terrestrial, the sound of E.T. walking was made by someone squishing jelly in wet rags.",
  "The Jurassic Park T-Rex would often 'come to life' in the rain because the animatronic's skin would absorb water and twitch.",
  "1917 was filmed in long, continuous takes, with the longest take lasting about nine minutes.",
  "Jackie Chan famously performs all his own stunts and holds the record for 'Most Stunts by a Living Actor'.",
  "In Django Unchained, Leonardo DiCaprio accidentally smashed a glass and cut his hand, but he kept acting and used the real blood for the scene.",
  "The Inception spinning top was actually a custom-made metal piece that cost hundreds of dollars to balance perfectly.",
  "The Matrix green code is actually a scan of a sushi cookbook translated into Japanese characters.",
  "The script for Rocky was written by Sylvester Stallone in just three and a half days.",
  "Avatar used 'virtual cameras' that allowed James Cameron to see the CGI world in real-time while filming live actors.",
  "In The Shining, Danny Lloyd (who played Danny) didn't know he was filming a horror movie; he thought it was a drama.",
  "The movie 300 was filmed entirely in a warehouse with green screens, except for one scene with horses.",
  "For Terminator 2, Linda Hamilton’s twin sister played the 'fake' Sarah Connor in the mirror scene.",
  "Scream (1996) was originally titled 'Scary Movie' until the producers changed it at the last minute.",
  "The Pulp Fiction briefcase contents are never revealed, but Quentin Tarantino says it's 'whatever the audience wants it to be'.",
  "WALL-E contains almost no dialogue for the first 40 minutes of the film.",
  "The sound of the TIE Fighter in Star Wars is a combination of an elephant call and a car driving on wet pavement.",
  "In A Clockwork Orange, Malcolm McDowell actually scratched his cornea during the 'eye-clamping' scene.",
  "Saving Private Ryan used real veterans from D-Day as consultants to ensure the Omaha Beach scene was as accurate as possible.",
  "The movie Mad Max: Fury Road used almost 80% practical effects and real vehicles, despite its futuristic look.",
  "Spirited Away remains the only hand-drawn, non-English language animation to win an Academy Award.",
  "In The Usual Suspects, the lineup scene was supposed to be serious, but the actors kept laughing, so the director used the funny take.",
  "The Truman Show was inspired by a Twilight Zone episode titled 'Special Service'.",
  "For Iron Man, Robert Downey Jr. actually had the 'burger' from the movie to help him get back into character.",
  "Fight Club director David Fincher hid a Starbucks cup in every single scene of the movie.",
  "The Titanic set was so large they had to build a new studio in Mexico just to house the water tanks.",
  "Raiders of the Lost Ark used over 6,000 snakes for the Well of Souls scene; most were harmless, but some were cobras.",
  "The Dark Knight Rises used 11,000 real extras for the Gotham Rogues football game scene.",
  "The Silence of the Lambs is one of only three movies to win the 'Big Five' Oscars.",
  "Up required Pixar to simulate the movement of over 10,000 individual balloons.",
  "In Spider-Man (2002), the cafeteria scene where Peter catches the food on a tray took 156 takes to get right without CGI.",
  "Heat (1995) features a shootout scene so realistic it's used as training footage for marine recruits.",
  "Braveheart used members of the Irish Army Reserves as extras for the battle scenes.",
  "The Lion King was the first Disney animated feature to be based on an original story idea.",
  "Interstellar consulted physicist Kip Thorne to ensure the black hole 'Gargantua' was scientifically accurate.",
  "The word 'Zombie' is never used in Night of the Living Dead.",
  "The first movie ever made was just 2 seconds long — 'Roundhay Garden Scene' (1888)."
];

const PLAYER_HTTP_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const SERIES_FACTS = [
  "The Sopranos used real mobsters as consultants to ensure the dialogue and behavior were authentic.",
  "Breaking Bad creator Vince Gilligan originally wanted the show to take place in Riverside, California.",
  "Game of Thrones had a budget of roughly $15 million per episode for its final season.",
  "The Simpsons is the longest-running American sitcom, having started as shorts in 1987.",
  "Friends was originally titled 'Insomnia Café' and then 'Friends Like Us' before settling on the final title.",
  "Stranger Things was rejected by 15-20 different networks before Netflix picked it up.",
  "The Wire was so realistic that real criminals and police officers praised its depiction of the drug trade.",
  "The Office (US) pilots were almost identical to the UK version, but the show eventually evolved.",
  "Squid Game was in development for over 10 years because studios thought the concept was too unrealistic.",
  "Succession's theme song has a 'broken' piano melody to symbolize the dysfunction of the family.",
  "Chernobyl (2019) used a sister plant to the actual Chernobyl in Lithuania for filming.",
  "Better Call Saul was originally envisioned as a 30-minute comedy before becoming a drama.",
  "Seinfeld had a 'no hugging, no learning' rule for its characters to avoid standard sitcom clichés.",
  "The Last of Us series used real-life locations in Alberta, Canada, meant to look like post-apocalyptic Boston.",
  "Twin Peaks was so mysterious that the cast didn't know who the killer was until the scene was filmed.",
  "The Bear used real professional chefs as consultants, and the actors underwent actual culinary training.",
  "Black Mirror got its name from the appearance of a turned-off screen: a cold, black mirror.",
  "The Mandalorian used a revolutionary LED screen technology called 'The Volume' instead of green screens.",
  "Sherlock (BBC) didn't have a pilot; it was originally intended to be 60 minutes long.",
  "Ted Lasso was originally a character created for NBC Sports commercials.",
  "Mr. Robot used real hacking techniques and code on-screen, often consulting with security experts.",
  "Mindhunter based its lead characters on real FBI agents who pioneered criminal profiling.",
  "Yellowstone is filmed largely on a real working ranch in Montana.",
  "Arcane took six years to produce, with some animators working on a single scene for months.",
  "The Crown has a research team of over 10 people to ensure historical accuracy.",
  "Peaky Blinders used over 3,000 cigarettes per season; the actors used nicotine-free herbal versions.",
  "Dark (Netflix) was the first German-language original series on the platform and became a global hit.",
  "The Boys (Amazon) used practical effects for many of its 'gorier' moments to give them a raw feel.",
  "Narcos used real news footage from the 1980s and 90s to ground the story in reality.",
  "Beef (Netflix) was inspired by a real-life road rage incident that the creator experienced.",
  "Hannibal's food scenes were styled by a professional culinary artist to make 'human' meals look gourmet.",
  "The Queen's Gambit led to a 125% increase in chess set sales globally.",
  "House of Cards was the first series from a streaming platform to be nominated for a major Emmy.",
  "Atlanta was described by Donald Glover as 'Twin Peaks with rappers'.",
  "Curb Your Enthusiasm scripts are almost entirely improvised; the actors only get an outline.",
  "The White Lotus was originally intended to be a one-season 'limited series'.",
  "Fargo ensures that every season has a 'Coen Brothers-esque' vibe.",
  "Westworld used a real self-playing piano to symbolize the 'programmed' nature of the hosts.",
  "Sons of Anarchy had real Hells Angels members as cast members and consultants.",
  "Mad Men had a strict 'no anachronism' policy, ensuring every detail was historically perfect.",
  "The Walking Dead extras had to attend 'Zombie School' to learn how to move like walkers.",
  "Money Heist (La Casa de Papel) was almost canceled in Spain before Netflix picked it up.",
  "Henry Cavill is a massive fan of The Witcher games and books and lobbied hard for the role.",
  "Fleabag started as a one-woman play at the Edinburgh Festival Fringe.",
  "Severance director Ben Stiller spent years developing the concept with creator Dan Erickson.",
  "The Leftovers used music from different genres to symbolize the chaotic 'departure'.",
  "Doctor Who is the longest-running science fiction television show in the world.",
  "Lost actors were often kept in the dark about their characters' futures to maintain mystery.",
  "Bluey has become a global hit because it depicts realistic, non-idealized parenting struggles.",
  "Band of Brothers put the actors through a ten-day boot camp to help them bond."
];

type PlayerScreenProps = NativeStackScreenProps<HomeStackParamList, "Player">;

type DirectSubtitleOption = {
  url: string;
  label: string;
  lang: string;
};

type ParsedSubtitleCue = {
  start: number;
  end: number;
  text: string;
};

function getSubtitleTrackLabel(track: SubtitleTrack): string {
  const label = track.label?.trim();
  if (label) return label;

  const language = track.language?.trim();
  if (language) return language.toUpperCase();

  return "Subtitle";
}

function decodeSubtitleText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseVttTimestamp(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  const parts = trimmed.split(":").map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return null;
}

/**
 * Extract the timestamp portion from the end-part of a VTT/SRT timing line.
 * After splitting "00:10.000 --> 00:13.083 align:start" by "-->",
 * endRaw is " 00:13.083 align:start". We need just "00:13.083".
 * Using `.split(" ")[0]` fails when there's a leading space (produces "").
 */
function extractTimestampFromEndPart(endRaw: string): string {
  const trimmed = endRaw.trim();
  // Take everything up to the first space (cue settings come after)
  const spaceIdx = trimmed.indexOf(" ");
  return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
}

function parseWebVtt(content: string): ParsedSubtitleCue[] {
  // Normalize all line ending variants: \r\n, \r (old Mac), \n
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // First try splitting by double newlines (standard VTT)
  let blocks = normalized.split(/\n{2,}/);

  // If we only get 1-2 blocks but there are multiple --> timestamps,
  // the file uses single-newline separation — parse line-by-line instead
  const arrowCount = (normalized.match(/-->/g) || []).length;
  if (blocks.length <= 2 && arrowCount > 1) {
    return parseWebVttLineByLine(normalized);
  }

  const cues: ParsedSubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;
    if (lines[0].toUpperCase().startsWith("WEBVTT")) continue;
    if (lines[0].startsWith("NOTE")) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIndex].split("-->");
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(extractTimestampFromEndPart(endRaw ?? ""));
    if (start == null || end == null) continue;

    const text = decodeSubtitleText(lines.slice(timeLineIndex + 1).join("\n")).trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  return cues;
}

/** Fallback parser for VTT files that use single-newline separation between cues */
function parseWebVttLineByLine(normalized: string): ParsedSubtitleCue[] {
  const lines = normalized.split("\n");
  const cues: ParsedSubtitleCue[] = [];
  let i = 0;

  // Skip WEBVTT header
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.toUpperCase().startsWith("WEBVTT") || trimmed === "" || trimmed.startsWith("NOTE")) {
      i++;
      continue;
    }
    break;
  }

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Skip empty lines and numeric cue IDs
    if (!trimmed || /^\d+$/.test(trimmed)) {
      i++;
      continue;
    }

    // Look for a timestamp line
    if (trimmed.includes("-->")) {
      const [startRaw, endRaw] = trimmed.split("-->");
      const start = parseVttTimestamp(startRaw);
      const end = parseVttTimestamp(extractTimestampFromEndPart(endRaw ?? ""));
      i++;

      if (start == null || end == null) continue;

      // Collect text lines until next timestamp or empty line
      const textLines: string[] = [];
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        if (!nextTrimmed || nextTrimmed.includes("-->") || /^\d+$/.test(nextTrimmed)) break;
        textLines.push(nextTrimmed);
        i++;
      }

      const text = decodeSubtitleText(textLines.join("\n")).trim();
      if (text) {
        cues.push({ start, end, text });
      }
    } else {
      i++;
    }
  }

  return cues;
}

function parseSubRip(content: string): ParsedSubtitleCue[] {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: ParsedSubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIndex].split("-->");
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(extractTimestampFromEndPart(endRaw ?? ""));
    if (start == null || end == null) continue;

    const text = decodeSubtitleText(lines.slice(timeLineIndex + 1).join("\n")).trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  return cues;
}

function parseSubtitleDocument(content: string): ParsedSubtitleCue[] {
  const vttCues = parseWebVtt(content);
  if (vttCues.length > 0) return vttCues;
  return parseSubRip(content);
}

function normalizeSubtitleUrl(url: string, ...bases: Array<string | null | undefined>): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";

  for (const base of bases) {
    if (!base) continue;
    try {
      return new URL(trimmed, base).toString();
    } catch {
      // Try next base.
    }
  }

  return trimmed;
}

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
    flex: 1,
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

type WebViewProviderSource = "hdfilm" | "dizipal";

// ---------------------------------------------------------------------------
// Injected player automation
// ---------------------------------------------------------------------------
const DIZIPAL_INJECT_BEFORE = `
(function() {
  'use strict';

  window.open = function() { return null; };

  var adDomains = ['doubleclick','googlesyndication','adnxs','popads','exoclick','trafficjunky','juicyads','propellerads','popcash','adserver','aj2204'];
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) return;
    return _xhrOpen.apply(this, arguments);
  };
  var _fetch = window.fetch;
  window.fetch = function(url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) {
      return Promise.reject(new Error('blocked'));
    }
    return _fetch.apply(this, arguments);
  };

  var baseStyle = document.createElement('style');
  baseStyle.id = 'app-player-base';
  baseStyle.textContent = [
    'html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }',
    'body { min-height: 100vh !important; }'
  ].join('\\n');
  (document.head || document.documentElement).appendChild(baseStyle);

  true;
})();
`;

function getEmbedInjectBefore(fit: 'contain' | 'cover' = 'contain') {
  return `
(function() {
  'use strict';
  window.open = function() { return null; };
  var baseStyle = document.getElementById('app-fit-style');
  if (!baseStyle) {
    baseStyle = document.createElement('style');
    baseStyle.id = 'app-fit-style';
    (document.head || document.documentElement).appendChild(baseStyle);
  }
  baseStyle.textContent = [
    '*, *::before, *::after { box-sizing: border-box !important; }',
    'html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 100vw !important; height: 100vh !important; }',
    '.first-notification, .modals, .pppx, .rek, .cc-overlay, [onclick*="kapasas"], [id*="google_ads"], ins.adsbygoogle { display: none !important; }',
    '#player, #playerbase, .jwplayer, .jw-wrapper, .jw-media, video { width: 100vw !important; height: 100vh !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 9990 !important; }',
    'video { object-fit: ${fit} !important; visibility: visible !important; opacity: 1 !important; z-index: 9991 !important; }',
    '.jw-controls, .jw-overlays, .vjs-control-bar, .plyr__controls { z-index: 9999 !important; visibility: visible !important; opacity: 1 !important; }',
    '.jw-aspect { padding-top: 0 !important; }'
  ].join('\\n');
  true;
})();
`;
}

function getEmbedInjectAfter(fit: 'contain' | 'cover' = 'contain') {
  return `
(function() {
  'use strict';
  var readySent = false;
  var notFoundSent = false;
  var readyFallbackTimer = null;

  function postReady(reason) {
    if (readySent || notFoundSent) return;
    readySent = true;
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'player_ready', reason: reason }));
    }
  }

  function cleanup() {
    var selectors = ['.first-notification', '.modals', '.pppx', '.rek', '.cc-overlay', '[onclick*="kapasas"]', '[class*="reklam"]', '.reklam_x', '.rek_close'];
    selectors.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });
    });

    if (typeof window.fireload === 'function' && !window.__fireloadCalled) {
      window.__fireloadCalled = true;
      try { window.fireload(); } catch(e) {}
    }
    if (typeof window.kapasas === 'function') {
      try { window.kapasas(); } catch(e) {}
    }
  }

  function isInsidePlayerControls(el) {
    // Returns true if the element is inside JWPlayer/VJS control bars
    // (not the big center play overlay, but the bottom bar controls).
    var cur = el;
    while (cur && cur !== document.body) {
      var cls = (cur.className || '').toString();
      if (cls.indexOf('jw-controlbar') !== -1 || cls.indexOf('jw-settings') !== -1 ||
          cls.indexOf('vjs-control-bar') !== -1) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function clickPlaybackPrompts(doc) {
    if (!doc) return;
    // Click play overlays and start buttons, but NEVER touch JWPlayer/VJS control bar internals
    var targets = doc.querySelectorAll(
      'button, [role="button"], a, div, span, .play-button, .vjs-big-play-button, ' +
      '.jw-display-icon-container, .plyr__control--overlaid, #playerCover, .player-cover-overlay'
    );
    targets.forEach(function(btn) {
      if (btn.__sbClicked) return;
      if (isInsidePlayerControls(btn)) return;

      var text = (btn.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
      var cls = (btn.className || '').toString().toLowerCase();
      var id = (btn.id || '').toString().toLowerCase();
      
      var shouldClick =
        cls.indexOf('jw-display-icon') !== -1 ||
        cls.indexOf('vjs-big-play') !== -1 ||
        cls.indexOf('play-button') !== -1 ||
        cls.indexOf('plyr__control--overlaid') !== -1 ||
        cls.indexOf('cover') !== -1 ||
        id === 'playercover' || id === 'skipbtn' ||
        text.indexOf('videoyu') !== -1 ||
        text.indexOf('baslat') !== -1 ||
        text.indexOf('izle') !== -1 ||
        text.indexOf('tikla') !== -1 ||
        text.indexOf('gec') !== -1 ||
        text.indexOf('skip') !== -1 ||
        text === 'play' || text === 'start';

      if (shouldClick) {
        btn.__sbClicked = true;
        btn.click();
      }
    });

    try {
      doc.querySelectorAll('iframe').forEach(function(ifrm) {
        var ifrmDoc = ifrm.contentDocument || (ifrm.contentWindow ? ifrm.contentWindow.document : null);
        if (ifrmDoc) clickPlaybackPrompts(ifrmDoc);
      });
    } catch(e) {}
  }

  function showPlayerArea() {
    var playerItems = document.querySelectorAll('video, iframe, #player, #playerbase, .jwplayer, .video-js, .plyr');
    playerItems.forEach(function(el) {
      var curr = el;
      while (curr && curr !== document.body) {
        curr.style.setProperty('display', 'block', 'important');
        curr.style.setProperty('visibility', 'visible', 'important');
        curr.style.setProperty('opacity', '1', 'important');
        curr = curr.parentElement;
      }
    });
  }

  function bindVideo(video) {
    if (!video || video.__bound) return;
    video.__bound = true;
    ['playing', 'canplay', 'loadeddata'].forEach(function(evt) {
      video.addEventListener(evt, function() { postReady('embed-video-' + evt); });
    });
    if (video.readyState >= 2) postReady('embed-video-ready');

    // Force visibility and fit
    video.style.setProperty('object-fit', '${fit}', 'important');
    video.style.setProperty('visibility', 'visible', 'important');
    video.style.setProperty('opacity', '1', 'important');
  }

  function scanAndBind(doc) {
    var root = doc || document;
    root.querySelectorAll('video').forEach(bindVideo);
    
    try {
      root.querySelectorAll('iframe').forEach(function(ifrm) {
        var ifrmDoc = ifrm.contentDocument || (ifrm.contentWindow ? ifrm.contentWindow.document : null);
        if (ifrmDoc) scanAndBind(ifrmDoc);
      });
    } catch(e) {}

    if (root === document && typeof window.jwplayer === 'function') {
      try {
        var jw = window.jwplayer();
        if (jw && !jw.__bound && typeof jw.on === 'function') {
          jw.__bound = true;
          jw.on('play', function() { postReady('jwplayer-play'); });
          jw.on('firstFrame', function() { postReady('jwplayer-firstFrame'); });
        }
        if (jw && typeof jw.getState === 'function' && jw.getState() === 'playing') {
          postReady('jwplayer-state-playing');
        }
      } catch(e) {}
    }
  }

  function forceResize() {
    if (typeof window.jwplayer === 'function') {
      try {
        var jw = window.jwplayer();
        if (jw && typeof jw.resize === 'function') jw.resize(window.innerWidth, window.innerHeight);
      } catch(e) {}
    }
  }

  function monitor() {
    cleanup();
    scanAndBind(document);
    // Only do aggressive actions before the player is ready.
    // After readySent, stop interfering with the running player.
    if (!readySent) {
      clickPlaybackPrompts(document);
      showPlayerArea();
      forceResize();
    }
  }

  monitor();
  window.addEventListener('load', monitor);
  setInterval(monitor, 1000);
  new MutationObserver(monitor).observe(document.documentElement, { childList: true, subtree: true });

  // Hard fallback: if we have a jwplayer or video on screen after 6s, just show it
  setTimeout(function() {
    if (!readySent) {
      var p = document.querySelector('video, .jwplayer, #player, iframe');
      if (p) postReady('embed-hard-fallback-6s');
    }
  }, 6000);

  true;
})();
`;
}

function getInjectBefore(source: WebViewProviderSource, fit: 'contain' | 'cover' = 'contain') {
  if (source === "dizipal") return DIZIPAL_INJECT_BEFORE;

  // Dynamic HDF_INJECT_BEFORE to handle initial fit
  return `
(function() {
  'use strict';
  window.open = function() { return null; };
  var adDomains = ['doubleclick','googlesyndication','adnxs','popads','exoclick','trafficjunky','juicyads','propellerads','popcash','adserver','aj2204'];
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) return;
    return _xhrOpen.apply(this, arguments);
  };
  var _fetch = window.fetch;
  window.fetch = function(url) {
    if (adDomains.some(function(domain) { return String(url).toLowerCase().includes(domain); })) {
      return Promise.reject(new Error('blocked'));
    }
    return _fetch.apply(this, arguments);
  };

  var hideStyle = document.createElement('style');
  hideStyle.id = 'app-player-hide';
  hideStyle.textContent = [
    'html, body { background: #000 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }',
    'body > *:not(script):not(style) { visibility: hidden !important; }'
  ].join('\\n');
  (document.head || document.documentElement).appendChild(hideStyle);

  var fitStyle = document.createElement('style');
  fitStyle.id = 'app-fit-style';
  fitStyle.textContent = 'video { object-fit: ${fit} !important; }';
  (document.head || document.documentElement).appendChild(fitStyle);

  true;
})();
`;
}

function getInjectAfter(
  source: WebViewProviderSource,
  mediaType: "movie" | "tv",
  fit: 'contain' | 'cover' = 'contain',
  seasonNumber?: number,
  episodeNumber?: number
) {
  return source === "dizipal"
    ? getDizipalInjectAfter()
    : getHdFilmInjectAfter(mediaType, fit, seasonNumber, episodeNumber);
}

function getHdFilmInjectAfter(mediaType: "movie" | "tv", fit: 'contain' | 'cover' = 'contain', seasonNumber?: number, episodeNumber?: number) {
  return `
(function() {
  'use strict';

  var isTv = ${mediaType === "tv"};
  var targetSeason = ${seasonNumber || 1};
  var targetEpisode = ${episodeNumber || 1};
  var readySent = false;
  var readyFallbackTimer = null;

  function postToApp(type, payload) {
    try {
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) return;
      var message = { type: type };
      if (payload) {
        for (var key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            message[key] = payload[key];
          }
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {}
  }

  function markPlaybackReady(reason) {
    if (readySent) return;
    readySent = true;
    if (readyFallbackTimer) clearTimeout(readyFallbackTimer);
    postToApp('player_ready', { reason: reason });
  }

  function scheduleReadyFallback(reason, delay) {
    if (readySent) return;
    if (readyFallbackTimer) clearTimeout(readyFallbackTimer);
    readyFallbackTimer = setTimeout(function() {
      markPlaybackReady(reason);
    }, delay);
  }

  function bindVideo(video) {
    if (!video || video.__streamboxBound) return;
    video.__streamboxBound = true;

    ['loadeddata', 'canplay', 'playing'].forEach(function(eventName) {
      video.addEventListener(eventName, function() {
        if (eventName === 'playing' || video.readyState >= 2) {
          markPlaybackReady('video-' + eventName);
        }
      });
    });

    if (video.readyState >= 2 && !video.paused) {
      markPlaybackReady('video-ready');
    } else if (video.readyState >= 2) {
      scheduleReadyFallback('video-buffered', 900);
    }
  }

  function bindKnownPlayerApis() {
    try {
      if (typeof window.jwplayer === 'function') {
        var jw = window.jwplayer();
        if (jw && !jw.__streamboxBound && typeof jw.on === 'function') {
          jw.__streamboxBound = true;
          jw.on('play', function() { markPlaybackReady('jwplayer-play'); });
          jw.on('buffer', function() { scheduleReadyFallback('jwplayer-buffer', 1200); });
          jw.on('firstFrame', function() { markPlaybackReady('jwplayer-first-frame'); });
        }
        if (jw && typeof jw.getState === 'function') {
          var state = jw.getState();
          if (state === 'playing') markPlaybackReady('jwplayer-state-playing');
          if (state === 'buffering') scheduleReadyFallback('jwplayer-state-buffering', 1200);
        }
      }
    } catch (e) {}
  }

  function scanForReadyPlayers(rootDoc) {
    var doc = rootDoc || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('video'), bindVideo);
    } catch (e) {}
    bindKnownPlayerApis();
  }

  function injectFullscreenStyleInFrame(frameDoc) {
    try {
      if (frameDoc.getElementById('sb-fs-fix')) return;
      var s = frameDoc.createElement('style');
      s.id = 'sb-fs-fix';
      s.textContent = [
        'html, body { margin:0!important; padding:0!important; overflow:hidden!important; width:100vw!important; height:100vh!important; background:#000!important; }',
        'video { object-fit:${fit}!important; width:100vw!important; height:100vh!important; position:fixed!important; top:0!important; left:0!important; }',
        '.jw-aspect { padding-top:0!important; }',
        '.jwplayer, .jw-wrapper, .jw-media, .jw-preview, .jw-overlays, .jw-controls, #player, #playerbase, .video-js, .plyr { width:100vw!important; height:100vh!important; position:fixed!important; top:0!important; left:0!important; }',
        '.jw-controls-backdrop, .jw-controlbar { position:fixed!important; bottom:0!important; left:0!important; width:100%!important; z-index:10!important; }'
      ].join('\\n');
      (frameDoc.head || frameDoc.documentElement).appendChild(s);
    } catch (e) {}
  }

  function inspectAccessibleFrame(frame) {
    try {
      var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
      if (!frameDoc) return;
      injectFullscreenStyleInFrame(frameDoc);
      scanForReadyPlayers(frameDoc);
    } catch (e) {}
  }

  function monitorIframes() {
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function(frame) {
      if (frame.__streamboxBound) return;
      frame.__streamboxBound = true;
      frame.addEventListener('load', function() {
        inspectAccessibleFrame(frame);
        scheduleReadyFallback('iframe-load', 2200);
      });
      inspectAccessibleFrame(frame);
    });
  }

  function monitorPlayback() {
    scanForReadyPlayers(document);
    monitorIframes();
  }

  window.addEventListener('load', function() {
    monitorPlayback();
    scheduleReadyFallback('window-load', 5000);
  });

  if (isTv && window.location.href.includes('/dizi/') && !window.location.href.includes('bolum')) {
    var navInterval = setInterval(function() {
      var links = document.querySelectorAll('a[href*="bolum"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].href.toLowerCase();
        if (
          (href.includes('sezon-' + targetSeason) || href.includes(targetSeason + '-sezon') || href.includes('sezon' + targetSeason)) &&
          (href.includes('bolum-' + targetEpisode) || href.includes(targetEpisode + '-bolum') || href.includes('bolum' + targetEpisode))
        ) {
          clearInterval(navInterval);
          window.location.href = links[i].href;
          return;
        }
      }
    }, 500);

    setTimeout(function() { clearInterval(navInterval); }, 10000);
    return;
  }

  var playerStyle = document.createElement('style');
  playerStyle.id = 'app-player-show';
  playerStyle.textContent = [
    'html, body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 100vw !important; height: 100vh !important; }',
    'header, footer, nav, aside, .sidebar, .comments, .related, .breadcrumb, .logo, [class*="header"]:not([class*="jw"]):not([class*="vjs"]), [class*="footer"]:not([class*="jw"]):not([class*="vjs"]), [class*="nav-"]:not([class*="jw"]):not([class*="vjs"]), [class*="sidebar"], [class*="comment"], [class*="social"], [class*="share"], [class*="bread"], [class*="cookie"], [class*="consent"], [class*="banner-"], .section-alt, .section-other, .rating, .detail-info, .film-info { display: none !important; }',
    '.player-wrapper, .player-area, .film-player, #player, .ke_post_body { margin: 0 !important; padding: 0 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 999999 !important; }',
    'iframe { width: 100vw !important; height: 100vh !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 999999 !important; border: none !important; }',
    'video { object-fit: ${fit} !important; width: 100vw !important; height: 100vh !important; position: fixed !important; top: 0 !important; left: 0 !important; }',
    '.jw-aspect { padding-top: 0 !important; }',
    '.jwplayer, .jw-wrapper, .jw-media, .jw-preview, .jw-overlays { width: 100vw !important; height: 100vh !important; position: fixed !important; top: 0 !important; left: 0 !important; }',
    '[class*="jw-"], [class*="vjs-"], [class*="plyr"], .jw-controlbar, .jw-controls, .jw-slider-time, .jw-icon, .jw-button-container, .jw-settings-menu, .jw-display, .jw-display-icon-container, .jw-icon-fullscreen, .jw-icon-volume, .jw-text-elapsed, .jw-text-duration, .jw-overlay, .vjs-control-bar, .vjs-progress-control, .vjs-play-control, .vjs-volume-panel { display: flex !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; }',
    'ins.adsbygoogle, [id*="google_ads"], [class*="ad-container"], [class*="ad-wrapper"], .ad, .ads, [class*="advert"], [class*="popup"]:not([class*="jw"]):not([class*="vjs"]), [id*="popup"], .popup-overlay { display: none !important; }',
    'a[href*="download"], a[href*="indir"], a[download] { display: none !important; pointer-events: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }',
    '[class*="yardim"], [class*="indir"], [id*="yardim"], [id*="indir"] { display: none !important; pointer-events: none !important; visibility: hidden !important; }'
  ].join('\\n');
  (document.head || document.documentElement).appendChild(playerStyle);

  function forceVideoFullscreen(doc) {
    try {
      doc.querySelectorAll('video').forEach(function(v) {
        v.style.setProperty('object-fit', '${fit}', 'important');
        v.style.setProperty('width', '100vw', 'important');
        v.style.setProperty('height', '100vh', 'important');
        v.style.setProperty('position', 'fixed', 'important');
        v.style.setProperty('top', '0', 'important');
        v.style.setProperty('left', '0', 'important');
      });
      doc.querySelectorAll('.jw-aspect').forEach(function(el) {
        el.style.setProperty('padding-top', '0', 'important');
      });
      doc.querySelectorAll('.jwplayer, .jw-wrapper, .jw-media, .jw-preview, .jw-overlays, #player, #playerbase').forEach(function(el) {
        el.style.setProperty('width', '100vw', 'important');
        el.style.setProperty('height', '100vh', 'important');
        el.style.setProperty('position', 'fixed', 'important');
        el.style.setProperty('top', '0', 'important');
        el.style.setProperty('left', '0', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
        el.style.setProperty('display', 'block', 'important');
      });
    } catch (e) {}
  }

  function showPlayerArea() {
    var playerContainers = document.querySelectorAll('.kePlayerCont, .player-wrapper, .film-player, #player, #playerbase, [class*="player"], .video-container, .ke_post_body, video, iframe[src*="vidmoly"], iframe[src*="rapid"], iframe[src*="closeload"], iframe[src*="ok.ru"]');
    playerContainers.forEach(function(el) {
      var current = el;
      while (current && current !== document.body) {
        current.style.setProperty('display', 'block', 'important');
        current.style.setProperty('visibility', 'visible', 'important');
        current.style.setProperty('opacity', '1', 'important');
        current = current.parentElement;
      }
      document.body.style.setProperty('display', 'block', 'important');
      document.body.style.setProperty('visibility', 'visible', 'important');
    });

    forceVideoFullscreen(document);
    document.querySelectorAll('iframe').forEach(function(frame) {
      try {
        var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        if (fd) forceVideoFullscreen(fd);
      } catch (e) {}
    });
  }

  function clickRapidrame() {
    var buttons = document.querySelectorAll('button, a, [data-link], .alternative-link');
    var clicked = false;
    buttons.forEach(function(btn) {
      if (!clicked && btn.textContent && btn.textContent.toLowerCase().includes('rapidrame')) {
        btn.click();
        clicked = true;
      }
    });
    if (!clicked) {
      var firstServer = document.querySelector('.alternative-link, .server-item, [class*="server"]');
      if (firstServer) {
        firstServer.click();
        clicked = true;
      }
    }
    return clicked;
  }

  function clickPlay() {
    var hdfPlay = document.querySelector('[class*="play-icon"], [class*="play-overlay"], .hdf-play');
    if (hdfPlay) hdfPlay.click();

    var playBtns = document.querySelectorAll('.jw-display-icon-container, .jw-icon-display, .vjs-big-play-button, [class*="play-button"], .play-btn');
    playBtns.forEach(function(button) { button.click(); });

    var videos = document.querySelectorAll('video');
    videos.forEach(function(video) {
      try { video.play(); } catch (e) {}
    });

    var iframes = document.querySelectorAll('iframe');
    iframes.forEach(function(frame) {
      try {
        var frameDoc = frame.contentDocument || frame.contentWindow.document;
        var framePlay = frameDoc.querySelector('.jw-display-icon-container, .jw-icon-display, [class*="play"], video');
        if (framePlay && framePlay.click) framePlay.click();
        var frameVideo = frameDoc.querySelector('video');
        if (frameVideo) frameVideo.play().catch(function() {});
      } catch (e) {}
    });
  }

  var controlWhitelist = /jw-|vjs-|plyr|jwplayer|video-js|controlbar|slider-time|icon-fullscreen|icon-volume|icon-display|display-icon|settings-menu|play-control|progress-control|volume-panel|text-elapsed|text-duration|big-play|captions|audio-tracks|kePlayer|player-wrapper|film-player|ke-title/i;

  function nukeElement(el) {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('width', '0', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.removeAttribute('href');
    el.onclick = function(e) { e.preventDefault(); e.stopPropagation(); return false; };
    if (el.parentElement && el.parentElement.tagName !== 'BODY') {
      var parent = el.parentElement;
      var parentText = (parent.textContent || '').trim().toLowerCase();
      var text = (el.textContent || '').trim().toLowerCase();
      if (parentText === text) {
        parent.style.setProperty('display', 'none', 'important');
        parent.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  function hideButtonsInDoc(doc) {
    var blockedLabels = ['yardım', 'yardim'];
    var blockedHrefPatterns = ['download', 'indir'];

    doc.querySelectorAll('a, button, span, div').forEach(function(el) {
      var text = (el.textContent || '').trim().toLowerCase();

      // Match by text content (Yardım etc.)
      if (text) {
        for (var i = 0; i < blockedLabels.length; i++) {
          if (text === blockedLabels[i] || text.indexOf(blockedLabels[i]) === 0) {
            nukeElement(el);
            return;
          }
        }
      }

      // Match by href containing download/indir patterns
      var href = (el.getAttribute('href') || '').toLowerCase();
      if (href) {
        for (var j = 0; j < blockedHrefPatterns.length; j++) {
          if (href.indexOf(blockedHrefPatterns[j]) !== -1) {
            nukeElement(el);
            return;
          }
        }
      }
    });
  }

  function injectHideStyleInDoc(doc) {
    try {
      if (doc.getElementById('sb-hide-btns')) return;
      var s = doc.createElement('style');
      s.id = 'sb-hide-btns';
      s.textContent = 'a[href*="download"], a[href*="indir"], a[download] { display:none!important; pointer-events:none!important; visibility:hidden!important; width:0!important; height:0!important; overflow:hidden!important; }';
      (doc.head || doc.documentElement).appendChild(s);
    } catch (e) {}
  }

  function hideHdfilmUiButtons() {
    hideButtonsInDoc(document);
    document.querySelectorAll('iframe').forEach(function(frame) {
      try {
        var fd = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        if (fd) {
          injectHideStyleInDoc(fd);
          hideButtonsInDoc(fd);
        }
      } catch (e) {}
    });
  }

  function removeAdOverlays() {
    document.querySelectorAll('*').forEach(function(el) {
      try {
        var cls = (el.className || '').toString();
        var id = (el.id || '').toString();
        if (controlWhitelist.test(cls) || controlWhitelist.test(id)) return;
        if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO') return;
        if (el.closest && (el.closest('.jwplayer') || el.closest('.video-js') || el.closest('.jw-wrapper') || el.closest('[class*="jw-"]'))) return;

        var style = getComputedStyle(el);
        var zIndex = parseInt(style.zIndex || '0', 10);
        if ((style.position === 'fixed' || style.position === 'absolute') && zIndex > 5000) {
          if (zIndex === 999999 || cls.includes('player') || id.includes('player')) return;
          el.style.setProperty('display', 'none', 'important');
        }
      } catch (e) {}
    });
  }

  showPlayerArea();
  hideHdfilmUiButtons();
  monitorPlayback();

  setTimeout(function() {
    clickRapidrame();
    showPlayerArea();
    hideHdfilmUiButtons();
    scheduleReadyFallback('rapidrame-click', 5000);
  }, 1500);

  setTimeout(function() {
    showPlayerArea();
    clickPlay();
    removeAdOverlays();
    hideHdfilmUiButtons();
    monitorPlayback();
    scheduleReadyFallback('play-attempt', 3200);
  }, 4000);

  setTimeout(function() {
    clickPlay();
    removeAdOverlays();
    hideHdfilmUiButtons();
    monitorPlayback();
    scheduleReadyFallback('second-play-attempt', 2200);
  }, 6000);

  setInterval(removeAdOverlays, 2000);
  setInterval(hideHdfilmUiButtons, 1500);
  setInterval(monitorPlayback, 1000);

  new MutationObserver(function() {
    if (!readySent) showPlayerArea();
    removeAdOverlays();
    hideHdfilmUiButtons();
    monitorPlayback();
  }).observe(document.documentElement, { childList: true, subtree: true });

  true;
})();
`;
}

function getDizipalInjectAfter() {
  return `
(function() {
  'use strict';

  var readySent = false;
  var notFoundSent = false;
  var readyFallbackTimer = null;
  var notFoundTimer = null;
  var lastStartAttemptAt = 0;
  var playerShellVisibleAt = 0;

  function postToApp(type, payload) {
    try {
      var message = { type: type, href: window.location.href };
      if (payload) {
        for (var key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            message[key] = payload[key];
          }
        }
      }
      var messageStr = JSON.stringify(message);

      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(messageStr);
      } else {
        window.top.postMessage(messageStr, '*');
      }
    } catch (e) {
      try { window.top.postMessage(JSON.stringify({ type: type }), '*'); } catch (e2) {}
    }
  }

  function clearTimers() {
    if (readyFallbackTimer) {
      clearTimeout(readyFallbackTimer);
      readyFallbackTimer = null;
    }
    if (notFoundTimer) {
      clearTimeout(notFoundTimer);
      notFoundTimer = null;
    }
  }

  function markPlaybackReady(reason) {
    if (readySent || notFoundSent) return;
    readySent = true;
    clearTimers();
    postToApp('player_ready', { reason: reason });
  }

  function markNotFound(reason) {
    if (readySent || notFoundSent) return;
    notFoundSent = true;
    clearTimers();
    postToApp('player_not_found', { reason: reason });
  }

  window.addEventListener('message', function(e) {
    try {
      if (typeof e.data === 'string') {
        var parsed = JSON.parse(e.data);
        if (parsed.type === 'player_ready') {
          markPlaybackReady(parsed.reason || 'iframe-message');
        } else if (parsed.type === 'player_not_found') {
          markNotFound(parsed.reason || 'iframe-message');
        }
      }
    } catch (err) {}
  });

  function normalizeText(value) {
    try {
      return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) {
      return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
  }

  function isStartPromptText(text) {
    var normalized = normalizeText(text);
    return (
      normalized.indexOf('videoyu baslat') !== -1 ||
      normalized.indexOf('izlemeye basla') !== -1 ||
      normalized.indexOf('izle') !== -1 ||
      normalized.indexOf('oynat') !== -1 ||
      normalized.indexOf('reklami gec') !== -1 ||
      normalized.indexOf('skip ad') !== -1 ||
      normalized.indexOf('tikla') !== -1 ||
      normalized.indexOf('baslat') !== -1 ||
      normalized === 'play' ||
      normalized === 'start'
    );
  }

  function hasVisiblePlayerContent() {
    if (window.location.hostname.indexOf('dizipal') === -1) {
      if (!playerShellVisibleAt) playerShellVisibleAt = Date.now();
      scheduleReadyFallback('dizipal-iframe-ultimate-fallback', 10000);
      return true;
    }

    var mainPlayer = document.getElementById('mainPlayer');
    var playerContent = document.getElementById('playerContent');
    var hasEmbed = !!document.querySelector('#playerContent iframe, #playerContent video, #playerContent embed, #playerContent object, #mainPlayer iframe, #mainPlayer video');
    var mainVisible = !!(mainPlayer && getComputedStyle(mainPlayer).display !== 'none' && getComputedStyle(mainPlayer).visibility !== 'hidden');
    var childCount = playerContent ? playerContent.children.length : 0;
    var promptVisible = documentHasStartPrompt(document);
    var isVisible = hasEmbed || (mainVisible && childCount > 0 && !promptVisible);

    if (isVisible && !playerShellVisibleAt) {
      playerShellVisibleAt = Date.now();
    }

    return isVisible;
  }

  function scheduleReadyFallback(reason, delay) {
    if (readySent || notFoundSent) return;
    if (readyFallbackTimer) return; // Do not constantly reset the timer!

    readyFallbackTimer = setTimeout(function() {
      readyFallbackTimer = null;
      if (!hasVisiblePlayerContent() || documentHasStartPrompt(document)) {
        return;
      }

      markPlaybackReady(reason);
    }, delay);
  }

  function scheduleNotFound(reason, delay) {
    if (readySent || notFoundSent) return;
    if (notFoundTimer) return; // Do not continuously reset

    notFoundTimer = setTimeout(function() {
      notFoundTimer = null;
      if (!hasVisiblePlayerContent()) {
        markNotFound(reason);
      }
    }, delay);
  }

  function bindVideo(video) {
    if (!video || video.__streamboxBound) return;
    video.__streamboxBound = true;

    ['loadeddata', 'canplay', 'playing'].forEach(function(eventName) {
      video.addEventListener(eventName, function() {
        if (eventName === 'playing' || video.readyState >= 2) {
          markPlaybackReady('dizipal-video-' + eventName);
        }
      });
    });

    if (video.readyState >= 2 && !video.paused) {
      markPlaybackReady('dizipal-video-ready');
    } else if (video.readyState >= 2) {
      scheduleReadyFallback('dizipal-video-buffered', 1200);
    }
  }

  function scanForVideos(rootDoc) {
    var doc = rootDoc || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('video'), bindVideo);
    } catch (e) {}
  }

  function resolveClickableTarget(node) {
    if (!node || typeof node.closest !== 'function') {
      return node || null;
    }

    return node.closest('button, a, [role="button"], input, label, .play-btn, .skip-btn, .jw-display-icon-container, .jw-icon-display, .vjs-big-play-button') || node;
  }

  function dispatchSyntheticTap(node) {
    if (!node || typeof node.dispatchEvent !== 'function') {
      return;
    }

    ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'].forEach(function(eventName) {
      try {
        node.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      } catch (error) {}
    });
  }

  function clickNode(node) {
    var target = resolveClickableTarget(node);
    if (!target) return false;

    try {
      dispatchSyntheticTap(target);
      if (typeof target.focus === 'function') {
        try { target.focus(); } catch (e) {}
      }
      if (typeof target.click === 'function') {
        target.click();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function clickPlaybackPrompts(rootDoc) {
    var doc = rootDoc || document;
    var clicked = false;
    var selectors = [
      '#playerCover',
      '.player-cover-overlay',
      '.play-btn',
      '#skipBtn',
      '.skip-btn',
      '#prerollResumeBtn',
      '.jw-display-icon-container',
      '.jw-icon-display',
      '.vjs-big-play-button',
      '[class*="play-button"]',
      '[class*="play-btn"]',
      '[class*="play_btn"]',
      '[data-action="play"]',
      'button',
      'input',
      'a',
      '[role="button"]',
      'div',
      'span'
    ];

    try {
      Array.prototype.forEach.call(doc.querySelectorAll(selectors.join(',')), function(node) {
        var text = normalizeText(node.textContent || node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || '');
        var className = normalizeText(node.className || '');
        var id = normalizeText(node.id || '');
        var shouldClick =
          id === 'playercover' ||
          id === 'skipbtn' ||
          id === 'prerollresumebtn' ||
          className.indexOf('play-btn') !== -1 ||
          className.indexOf('jw-display-icon-container') !== -1 ||
          className.indexOf('jw-icon-display') !== -1 ||
          className.indexOf('vjs-big-play-button') !== -1 ||
          isStartPromptText(text);

        if (shouldClick && clickNode(node)) {
          clicked = true;
        }
      });
      
      // Recursive call for accessible iframes
      Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function(frame) {
        try {
          var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
          if (frameDoc && clickPlaybackPrompts(frameDoc)) {
            clicked = true;
          }
        } catch(e) {}
      });
    } catch (e) {}

    return clicked;
  }

  function documentHasStartPrompt(rootDoc) {
    var doc = rootDoc || document;
    try {
      return Array.prototype.some.call(doc.querySelectorAll('button, a, [role="button"], div, span'), function(node) {
        return isStartPromptText(node.textContent || node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      });
    } catch (e) {
      return false;
    }
  }

  function nudgeVideos(rootDoc) {
    var doc = rootDoc || document;
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('video'), function(video) {
        bindVideo(video);
        try {
          var playResult = video.play();
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(function() {});
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function inspectAccessibleFrame(frame) {
    try {
      var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
      if (!frameDoc) return;
      scanForVideos(frameDoc);
      clickPlaybackPrompts(frameDoc);
      nudgeVideos(frameDoc);
    } catch (e) {}
  }

  function monitorIframes() {
    Array.prototype.forEach.call(document.querySelectorAll('#playerContent iframe, #mainPlayer iframe, iframe'), function(frame) {
      if (frame.__streamboxBound) return;
      frame.__streamboxBound = true;
      frame.addEventListener('load', function() {
        inspectAccessibleFrame(frame);
        scheduleReadyFallback('dizipal-iframe-load', 8000);
      });
      inspectAccessibleFrame(frame);
    });
  }

  function applyPlayerChrome() {
    if (document.getElementById('streambox-dizipal-style')) return;

    var style = document.createElement('style');
    style.id = 'streambox-dizipal-style';
    style.textContent = [
      'html, body, .site-wrapper, .main-content, .watch-page, .watch-page.film-page, .watch-page .container, .video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { background: #000 !important; margin: 0 !important; padding: 0 !important; }',
      '.site-wrapper, .main-content, .watch-page, .watch-page .container, .video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { width: 100vw !important; max-width: 100vw !important; }',
      '.watch-page, .watch-page .container, .video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { height: 100vh !important; min-height: 100vh !important; }',
      '.video-wrapper, .video-player-container, .video-player-wrapper, #mainPlayer, #playerContent { position: fixed !important; inset: 0 !important; z-index: 999999 !important; display: flex !important; align-items: center !important; justify-content: center !important; }',
      '#playerContent iframe, #mainPlayer iframe, #playerContent video, #mainPlayer video { width: 100vw !important; height: 100vh !important; border: none !important; z-index: 10 !important; max-width: 100% !important; max-height: 100% !important; }',
      '.jw-controls, .vjs-control-bar, .jw-controlbar, .video-controls, .player-controls { z-index: 9999999 !important; visibility: visible !important; }',
      '.pageskin-desktop-wrapper, .pageskin-click-left, .pageskin-click-right, .pageskin-mobile-wrapper, .main-header, .announcement-bar, .main-footer, .mobile-bottom-nav, .footer-sticky-ad, .ad-container, .embed-text-banner, .film-info-box, .episode-navigation, .episode-panel, .comments-section, .related-section, .watch-title-top, .series-hero, .watch-hero, .modal, .fade, .show, .popup { display: none !important; }'
    ].join('\\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function removeNoise() {
    var selectors = [
      '.pageskin-desktop-wrapper',
      '.pageskin-click-left',
      '.pageskin-click-right',
      '.pageskin-mobile-wrapper',
      '.main-header',
      '.announcement-bar',
      '.main-footer',
      '.mobile-bottom-nav',
      '.footer-sticky-ad',
      '.ad-container',
      '.embed-text-banner',
      '.film-info-box',
      '.episode-navigation',
      '.episode-panel',
      '.comments-section',
      '.related-section',
      '.watch-title-top',
      '.series-hero',
      '.watch-hero'
    ];

    selectors.forEach(function(selector) {
      document.querySelectorAll(selector).forEach(function(element) {
        element.style.setProperty('display', 'none', 'important');
        element.style.setProperty('visibility', 'hidden', 'important');
        element.style.setProperty('pointer-events', 'none', 'important');
      });
    });

    document.querySelectorAll('a[target="_blank"], .modal, .fade, .show, .popup, [id*="google_ads"]').forEach(function(el) {
      if (el.closest('.video-player-container') || el.closest('#mainPlayer') || el.closest('#playerContent')) return;
      // Do NOT hide elements that look like start prompts (might be the "VİDEOYU BAŞLAT" modal)
      var text = (el.textContent || '').toLowerCase();
      if (text.indexOf('videoyu') !== -1 || text.indexOf('baslat') !== -1 || text.indexOf('oynat') !== -1) return;
      
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    });

    var clickable = document.getElementById('prerollClickable');
    if (clickable) {
      clickable.onclick = null;
      clickable.style.setProperty('pointer-events', 'none', 'important');
    }
  }

  function managePreroll(rootDoc) {
    var doc = rootDoc || document;
    try {
      var videos = doc.querySelectorAll('video');
      Array.prototype.forEach.call(videos, function(v) {
        if (v.id === 'prerollVideo' || v.className.indexOf('ad-') !== -1 || v.duration < 60) {
          v.muted = true;
          if (v.playbackRate < 8) v.playbackRate = 16.0;
        }
      });

      var skipBtn = doc.getElementById('skipBtn');
      if (skipBtn && getComputedStyle(skipBtn).display !== 'none') {
        clickNode(skipBtn);
      }

      var allNodes = doc.querySelectorAll('button, div, a, span');
      Array.prototype.forEach.call(allNodes, function(node) {
        var txt = normalizeText(node.textContent || node.innerText || '');
        if (txt.indexOf('reklami gec') !== -1 || txt.indexOf('skip ad') !== -1) {
          clickNode(node);
        }
      });
      
      Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function(frame) {
        try {
          var frameDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
          if (frameDoc) managePreroll(frameDoc);
        } catch(e) {}
      });
    } catch (e) {}
  }

  var windowStartPlayerCalled = false;

  function startPlayerNow(forceReason) {
    if (readySent || notFoundSent) return;

    var now = Date.now();
    if (!forceReason && now - lastStartAttemptAt < 900) {
      return;
    }

    lastStartAttemptAt = now;
    managePreroll(document);
    clickPlaybackPrompts(document);

    if (!windowStartPlayerCalled && typeof window.startPlayer === 'function') {
      try {
        window.startPlayer();
        windowStartPlayerCalled = true;
      } catch (e) {}
    }

    var cover = document.getElementById('playerCover');
    if (cover) {
      clickNode(cover);
    }

    clickPlaybackPrompts(document);
    nudgeVideos(document);
    scheduleNotFound('dizipal-start-timeout', 35000);
  }

  function monitorPlayback() {
    scanForVideos(document);
    monitorIframes();
    managePreroll(document); // Always try to skip ads in the main document recursively

    if (!readySent && !notFoundSent) {
      clickPlaybackPrompts(document);
      nudgeVideos(document);

      if (hasVisiblePlayerContent() && !documentHasStartPrompt(document)) {
        if (playerShellVisibleAt && (Date.now() - playerShellVisibleAt > 5000)) {
          markPlaybackReady('dizipal-mainplayer-visible-5s');
        }
      }

      if (documentHasStartPrompt(document)) {
        startPlayerNow(false);
      }
    }
  }

  function hookConsoleErrors() {
    var originalError = console.error;
    console.error = function() {
      try {
        var message = Array.prototype.map.call(arguments, function(value) { return String(value); }).join(' ');
        if (message.toLowerCase().indexOf('no video config') !== -1) {
          markNotFound('dizipal-no-video-config');
        }
      } catch (e) {}
      if (originalError) {
        return originalError.apply(console, arguments);
      }
    };
  }

  hookConsoleErrors();
  applyPlayerChrome();
  removeNoise();
  managePreroll();

  window.addEventListener('load', function() {
    applyPlayerChrome();
    removeNoise();
    managePreroll();
    startPlayerNow(true);
    monitorPlayback();
  });

  setTimeout(function() {
    startPlayerNow(true);
    monitorPlayback();
  }, 350);

  setTimeout(function() {
    startPlayerNow(true);
    monitorPlayback();
  }, 2200);

  setInterval(function() {
    applyPlayerChrome();
    removeNoise();
    managePreroll();
    monitorPlayback();
  }, 1000);

  new MutationObserver(function() {
    applyPlayerChrome();
    removeNoise();
    managePreroll();
    monitorPlayback();
  }).observe(document.documentElement, { childList: true, subtree: true });

  scheduleNotFound('dizipal-initial-timeout', 25000);

  // Hard fallback: if anything is on screen after 12s, dismiss spinner
  setTimeout(function() {
    if (!readySent && !notFoundSent) {
      var anyContent = document.querySelector('iframe, video, embed, object, #mainPlayer iframe, #playerContent iframe, #mainPlayer video, #playerContent video');
      if (anyContent && !documentHasStartPrompt(document)) {
        markPlaybackReady('dizipal-hard-fallback-12s');
      }
    }
  }, 12000);

  true;
})();
`;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export function PlayerScreen({ route, navigation }: PlayerScreenProps) {
  const theme = useTheme();
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

  useEffect(() => {
    return () => {
      const currentWebView = webViewRef.current as unknown as {
        stopLoading?: () => void;
        clearCache?: (includeDiskFiles: boolean) => void;
        clearHistory?: () => void;
      } | null;

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
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true
    }).start(() => setControlsVisible(false));
  }, [controlsOpacity, clearHideTimer]);

  const scheduleHideControls = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(hideControlsNow, AUTO_HIDE_MS);
  }, [clearHideTimer, hideControlsNow]);

  const showControls = useCallback(() => {
    clearHideTimer();
    controlsVisibleRef.current = true;
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
        console.log("[Player] URL:", result.url, "source:", result.source, "streamUrl:", result.streamUrl ?? "none", "streamType:", result.streamType ?? "none");

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
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    navigation.goBack();
  }, [navigation]);

  const handleNavChange = useCallback((s: WebViewNavigation) => setCanGoBack(s.canGoBack), []);
  const handlePlaybackReady = useCallback(() => {
    setIsPlaybackReady(true);
  }, []);
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload?.type === "player_ready") {
        setLoadError(null);
        setIsPlaybackReady(true);
        return;
      }
      if (payload?.type === "player_not_found") {
        setLoadError(null);
        setIsPlaybackReady(false);
        setPlayerResult({ url: "", source: "not_found" });
      }
    } catch {
      // Ignore unrelated WebView messages.
    }
  }, []);
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

    console.log("[Player] Loading direct stream:", directStreamUrl, "referer:", streamReferer);
    const contentType: ContentType | undefined = directStreamType === "m3u8" ? "hls" : undefined;
    const source = {
      uri: directStreamUrl,
      headers: {
        ...(streamReferer ? { Referer: streamReferer } : {}),
        ...(streamReferer ? { Origin: new URL(streamReferer).origin } : {}),
        "User-Agent": PLAYER_HTTP_UA
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
        console.log("[Player] Ready â€” starting playback");
        console.log("[Player] Available subtitle tracks:", JSON.stringify(videoPlayer.availableSubtitleTracks));
        setAvailableSubtitleTracks(videoPlayer.availableSubtitleTracks);
        setSelectedSubtitleTrack(videoPlayer.subtitleTrack ?? null);
        videoPlayer.play();
        setIsPlaybackReady(true);
      }
      if (ev.status === "error") {
        console.log("[Player] Video error:", ev.error?.message);
        setPlayerResult((prev) => {
          if (prev?.source === "dizipal_direct") {
            return { url: prev.url, source: "dizipal" };
          }
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
      console.log("[Player] Subtitle tracks available:", JSON.stringify(ev.availableSubtitleTracks));
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
      "User-Agent": PLAYER_HTTP_UA,
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
        console.log(
          "[Player] Subtitle response preview:",
          response.data.slice(0, 200).replace(/\s+/g, " ")
        );
        const cues = parseSubtitleDocument(response.data);
        console.log("[Player] Parsed external subtitles:", selectedExternalSubtitle.label, cues.length);
        if (cues.length === 0) {
          // Log raw bytes to debug encoding issues
          const rawChars = response.data.slice(0, 60);
          console.log("[Player] Subtitle raw char codes:", Array.from(rawChars).map((c: string) => c.charCodeAt(0)).join(","));
        }
        setExternalSubtitleCues(cues);
      })
      .catch((error) => {
        if (cancelled) return;
        console.log("[Player] Failed to load external subtitles:", selectedExternalSubtitle.url, error?.message ?? String(error));
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
        {isLoading && (
          <PlayerLoadingOverlay
            title={route.params.title}
            seasonNumber={route.params.seasonNumber}
            episodeNumber={route.params.episodeNumber}
          />
        )}
        {!isLoading && (
          <VideoView
            player={videoPlayer}
            style={styles.nativePlayer}
            contentFit={videoFit}
            nativeControls
            surfaceType="textureView"
            onTouchEnd={toggleCloseBtn}
          />
        )}
        {!isLoading && isSubtitleMenuOpen && (
          <Pressable style={styles.subtitleMenuBackdrop} onPress={() => setIsSubtitleMenuOpen(false)} />
        )}
        {!isLoading && showCloseBtn && (
          <>
            <Animated.View style={[styles.closeButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.closeButtonInner}>
                <Feather name="x" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={[styles.scalingButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity onPress={toggleVideoFit} activeOpacity={0.8} style={styles.closeButtonInner}>
                <Feather name={videoFit === "contain" ? "maximize" : "minimize"} size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={[styles.ccButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity
                onPress={toggleDirectSubtitleMenu}
                activeOpacity={directSubtitleOptions.length > 0 || availableSubtitleTracks.length > 0 ? 0.8 : 1}
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
    <Pressable style={styles.root} onPress={toggleCloseBtn}>
      {/* Close â€” auto-hides after 3s, tap screen to toggle */}
      {showCloseBtn && (
        <>
          <Animated.View style={[styles.closeButton, { opacity: closeBtnOpacity }]}>
            <TouchableOpacity onPress={handleClose} activeOpacity={0.8} style={styles.closeButtonInner}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>

          {(playerResult?.source === 'hdfilm' || playerResult?.source === 'dizipal' || playerResult?.source === 'dizipal_embed') && (
            <Animated.View style={[styles.scalingButton, { opacity: closeBtnOpacity }]}>
              <TouchableOpacity onPress={toggleVideoFit} activeOpacity={0.8} style={styles.closeButtonInner}>
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
          <TouchableOpacity style={styles.retryButton} onPress={() => {
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
          <TouchableOpacity style={[styles.goBackButton, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.primary }]} onPress={handleClose} activeOpacity={0.8}>
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
          userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          onMessage={handleMessage}
          onError={handleError}
          onNavigationStateChange={handleNavChange}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.includes("about:blank")) return true;
            if (!req.url.startsWith("http")) return false; // Prevent deep links like market://
            if (!req.isTopFrame) return true;
            // Native player / Embed should rarely redirect the top frame.
            if (req.url !== playerResult.url) {
              return false;
            }
            return true;
          }}
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
          userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          onMessage={handleMessage}
          onError={handleError}
          onNavigationStateChange={handleNavChange}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.includes("about:blank")) return true;
            if (!req.url.startsWith("http")) return false; // Prevent deep links like market://
            if (!req.isTopFrame) return true;
            if (req.url !== playerResult.url) {
              return false;
            }
            return true;
          }}
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
    </Pressable>
  );
}

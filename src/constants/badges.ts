// Profile achievement badges. Every badge is derived from watch history at
// read time (see services/badgeEngine.ts) — no server state. Artwork is
// hand-built vector art in components/badges/BadgeArt.tsx keyed by id.

export type BadgeId =
  | "firstReel"
  | "rookie"
  | "regular"
  | "movieBuff"
  | "cinephile"
  | "filmFanatic"
  | "screenLegend"
  | "fearCollector"
  | "laughTrack"
  | "heartlines"
  | "caseClosed"
  | "starbound"
  | "marathonDay"
  | "timeTraveler"
  | "oldSoul"
  | "directorsCircle"
  | "hundredHours"
  | "seasonSlayer"
  | "octoberRites";

export type BadgeCategory = "milestones" | "genres" | "special";

export type BadgeDefinition = {
  id: BadgeId;
  category: BadgeCategory;
  /** Threshold that earns the badge (unit depends on the badge). */
  target: number;
  /** Ring/accent color used by the vector art and progress bar. */
  ringColor: string;
  /**
   * Movie-count ladder badges share one track; the profile strip shows only
   * the highest earned rank. Higher = later tier.
   */
  ladderRank?: number;
};

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // Watched-movies ladder (one evolving mascot, tier = ring color)
  { id: "firstReel", category: "milestones", target: 1, ringColor: "#94A3B8", ladderRank: 1 },
  { id: "rookie", category: "milestones", target: 10, ringColor: "#E8853D", ladderRank: 2 },
  { id: "regular", category: "milestones", target: 25, ringColor: "#34C77B", ladderRank: 3 },
  { id: "movieBuff", category: "milestones", target: 50, ringColor: "#3E8EF7", ladderRank: 4 },
  { id: "cinephile", category: "milestones", target: 100, ringColor: "#F5B120", ladderRank: 5 },
  { id: "filmFanatic", category: "milestones", target: 250, ringColor: "#8B5CF6", ladderRank: 6 },
  { id: "screenLegend", category: "milestones", target: 500, ringColor: "#EFB810", ladderRank: 7 },
  // Genre badges (10 watched titles in the genre)
  { id: "fearCollector", category: "genres", target: 10, ringColor: "#7C5CBF" },
  { id: "laughTrack", category: "genres", target: 10, ringColor: "#F7C948" },
  { id: "heartlines", category: "genres", target: 10, ringColor: "#F06292" },
  { id: "caseClosed", category: "genres", target: 10, ringColor: "#14B8A6" },
  { id: "starbound", category: "genres", target: 10, ringColor: "#38BDF8" },
  // Special badges
  { id: "marathonDay", category: "special", target: 3, ringColor: "#EF5350" },
  { id: "timeTraveler", category: "special", target: 6, ringColor: "#FB8C00" },
  { id: "oldSoul", category: "special", target: 10, ringColor: "#A97142" },
  { id: "directorsCircle", category: "special", target: 5, ringColor: "#5C6BC0" },
  { id: "hundredHours", category: "special", target: 6000, ringColor: "#A78BFA" },
  { id: "seasonSlayer", category: "special", target: 250, ringColor: "#22D3EE" },
  { id: "octoberRites", category: "special", target: 5, ringColor: "#F97316" },
];

export const BADGE_DEFINITION_MAP = new Map(BADGE_DEFINITIONS.map((def) => [def.id, def]));

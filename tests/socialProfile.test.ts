import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaCountFor,
  optimisticFollowState,
  rollbackFollowState,
  splitHydratableIds,
  type FollowableProfile,
  type HydratableRow,
  type MediaCounts,
} from "../src/utils/socialProfile";

// ── splitHydratableIds ──────────────────────────────────────────────────────
test("splitHydratableIds: empty input yields empty lists", () => {
  assert.deepEqual(splitHydratableIds([]), { movieIds: [], seriesIds: [] });
});

test("splitHydratableIds: splits by media type preserving order", () => {
  const rows: HydratableRow[] = [
    { mediaType: "movie", tmdbId: 10 },
    { mediaType: "tv", tmdbId: 20 },
    { mediaType: "movie", tmdbId: 11 },
    { mediaType: "tv", tmdbId: 21 },
  ];
  assert.deepEqual(splitHydratableIds(rows), { movieIds: [10, 11], seriesIds: [20, 21] });
});

test("splitHydratableIds: drops non-positive / non-finite tmdb ids (blank-card guard)", () => {
  const rows: HydratableRow[] = [
    { mediaType: "movie", tmdbId: 0 }, // internal-id-only import → 0
    { mediaType: "movie", tmdbId: -5 },
    { mediaType: "movie", tmdbId: Number.NaN },
    { mediaType: "tv", tmdbId: Number.POSITIVE_INFINITY },
    { mediaType: "movie", tmdbId: 42 },
    { mediaType: "tv", tmdbId: 99 },
  ];
  assert.deepEqual(splitHydratableIds(rows), { movieIds: [42], seriesIds: [99] });
});

test("splitHydratableIds: single-type inputs", () => {
  assert.deepEqual(
    splitHydratableIds([
      { mediaType: "movie", tmdbId: 1 },
      { mediaType: "movie", tmdbId: 2 },
    ]),
    { movieIds: [1, 2], seriesIds: [] }
  );
  assert.deepEqual(
    splitHydratableIds([
      { mediaType: "tv", tmdbId: 7 },
    ]),
    { movieIds: [], seriesIds: [7] }
  );
});

// ── mediaCountFor ───────────────────────────────────────────────────────────
const counts: MediaCounts = {
  watchedMovies: 200,
  watchedSeries: 50,
  watchlistMovies: 12,
  watchlistSeries: 3,
  likedMovies: 7,
  likedSeries: 9,
};

test("mediaCountFor: returns the exact per-(section, media) total (the 250 = 200+50 case)", () => {
  assert.equal(mediaCountFor(counts, "watched", "movie"), 200);
  assert.equal(mediaCountFor(counts, "watched", "tv"), 50);
  assert.equal(mediaCountFor(counts, "watchlist", "movie"), 12);
  assert.equal(mediaCountFor(counts, "watchlist", "tv"), 3);
  assert.equal(mediaCountFor(counts, "liked", "movie"), 7);
  assert.equal(mediaCountFor(counts, "liked", "tv"), 9);
});

test("mediaCountFor: missing fields count as 0 (older profile payloads)", () => {
  assert.equal(mediaCountFor({}, "watched", "movie"), 0);
  assert.equal(mediaCountFor({ likedSeries: 4 }, "liked", "tv"), 4);
  assert.equal(mediaCountFor({ likedSeries: 4 }, "liked", "movie"), 0);
});

// ── follow optimistic / rollback ────────────────────────────────────────────
const base: FollowableProfile & { userId: string } = {
  userId: "u1",
  isFollowing: false,
  counts: { followers: 3 },
};

test("optimisticFollow: following increments the follower count and flips the flag", () => {
  const next = optimisticFollowState(base, true);
  assert.equal(next.isFollowing, true);
  assert.equal(next.counts.followers, 4);
  // input is not mutated
  assert.equal(base.isFollowing, false);
  assert.equal(base.counts.followers, 3);
});

test("optimisticFollow: unfollowing decrements the follower count and flips the flag", () => {
  const following: FollowableProfile & { userId: string } = {
    userId: "u1",
    isFollowing: true,
    counts: { followers: 4 },
  };
  const next = optimisticFollowState(following, false);
  assert.equal(next.isFollowing, false);
  assert.equal(next.counts.followers, 3);
});

test("rollback is the exact inverse of the optimistic step (follow) — no drift", () => {
  const restored = rollbackFollowState(optimisticFollowState(base, true), true);
  assert.deepEqual(restored, base);
});

test("rollback is the exact inverse of the optimistic step (unfollow) — no drift", () => {
  const following: FollowableProfile & { userId: string } = {
    userId: "u1",
    isFollowing: true,
    counts: { followers: 4 },
  };
  const restored = rollbackFollowState(optimisticFollowState(following, false), false);
  assert.deepEqual(restored, following);
});

test("follow → fail → rollback nets zero change (the reported '1 then back to 0' path)", () => {
  // A failing follow: optimistic bumps 3→4, rollback returns it to 3 exactly.
  const optimistic = optimisticFollowState(base, true);
  assert.equal(optimistic.counts.followers, 4);
  const rolledBack = rollbackFollowState(optimistic, true);
  assert.equal(rolledBack.counts.followers, 3);
  assert.equal(rolledBack.isFollowing, false);
});

test("extra profile fields survive both transitions", () => {
  const rich = { ...base, displayName: "Night Owl", isSelf: false };
  const next = optimisticFollowState(rich, true);
  assert.equal(next.displayName, "Night Owl");
  assert.equal(next.isSelf, false);
  assert.deepEqual(rollbackFollowState(next, true), rich);
});

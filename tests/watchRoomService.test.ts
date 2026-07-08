import assert from "node:assert/strict";
import test from "node:test";

import { mapWatchRoomRow } from "../src/utils/watchRoom";

test("mapWatchRoomRow converts a snake_case room row into the camelCase domain shape", () => {
  const room = mapWatchRoomRow({
    id: "11111111-1111-1111-1111-111111111111",
    code: "AS9DYM",
    host_user_id: "host-uuid",
    media_type: "movie",
    tmdb_id: 27205,
    title: "Inception",
    poster_path: "/poster.jpg",
    backdrop_path: null,
    season_number: null,
    episode_number: null,
    status: "lobby",
    created_at: "2026-07-08T12:00:00.000Z",
    expires_at: "2026-07-09T00:00:00.000Z",
  });

  assert.equal(room.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(room.code, "AS9DYM");
  assert.equal(room.hostUserId, "host-uuid");
  assert.equal(room.mediaType, "movie");
  assert.equal(room.tmdbId, 27205);
  assert.equal(room.title, "Inception");
  assert.equal(room.posterPath, "/poster.jpg");
  assert.equal(room.backdropPath, null);
  assert.equal(room.status, "lobby");
  assert.equal(room.createdAtEpochMs, Date.parse("2026-07-08T12:00:00.000Z"));
  assert.equal(room.expiresAtEpochMs, Date.parse("2026-07-09T00:00:00.000Z"));
});

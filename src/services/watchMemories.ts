import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

import { supabase } from "./supabase";
import type { MediaType } from "../api/tmdb";

// Watch Together "Movie Memories": polaroid PNGs + the raw camera stills they
// are composed from, stored in the private `watch-memories` bucket under
// {room_id}/…, and a row per polaroid in watch_room_memories so both
// participants keep it on their shelf even after the room expires.

const BUCKET = "watch-memories";

async function uploadFile(path: string, uri: string, contentType: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function uploadCameraStill(roomId: string, uri: string): Promise<string> {
  const name = `${roomId}/stills/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  return uploadFile(name, uri, "image/jpeg");
}

export async function uploadPolaroid(roomId: string, uri: string): Promise<string> {
  const name = `${roomId}/polaroid-${Date.now()}.png`;
  return uploadFile(name, uri, "image/png");
}

export async function getMemoryImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export type WatchMemoryInput = {
  roomId: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  positionSeconds: number;
  imagePath: string;
  caption?: string | null;
  participantNicknames: string[];
  participantUserIds: string[];
};

export async function saveWatchMemory(input: WatchMemoryInput): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const createdBy = data.user?.id;
  if (!createdBy) throw new Error("Not authenticated.");

  const { error } = await supabase.from("watch_room_memories").insert({
    room_id: input.roomId,
    created_by: createdBy,
    media_type: input.mediaType,
    tmdb_id: input.tmdbId,
    title: input.title,
    position_seconds: Math.max(0, Math.round(input.positionSeconds)),
    image_path: input.imagePath,
    caption: input.caption ?? null,
    participant_nicknames: input.participantNicknames,
    participant_user_ids: input.participantUserIds,
  });
  if (error) throw error;
}

export type WatchMemory = {
  id: string;
  title: string;
  imagePath: string;
  caption: string | null;
  positionSeconds: number;
  participantNicknames: string[];
  createdAtEpochMs: number;
};

export async function listWatchMemories(userId: string): Promise<WatchMemory[]> {
  const { data, error } = await supabase
    .from("watch_room_memories")
    .select("id, title, image_path, caption, position_seconds, participant_nicknames, created_at")
    .contains("participant_user_ids", [userId])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    imagePath: row.image_path,
    caption: row.caption ?? null,
    positionSeconds: row.position_seconds ?? 0,
    participantNicknames: row.participant_nicknames ?? [],
    createdAtEpochMs: Date.parse(row.created_at),
  }));
}

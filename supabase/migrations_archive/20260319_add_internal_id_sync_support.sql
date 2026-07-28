-- Migration to support internal_id-based user synchronization
-- This adds the necessary columns and unique constraints for 'user_media_library' and 'user_watch_history'

begin;

-- 1. Update user_media_library
alter table public.user_media_library add column if not exists internal_id uuid;
alter table public.user_media_library alter column tmdb_id drop not null;

-- Drop existing composite primary key as we need either tmdb_id or internal_id to be null
alter table public.user_media_library drop constraint if exists user_media_library_pkey;

-- Add checking constraint to ensure at least one ID is present
alter table public.user_media_library add constraint user_media_library_id_presence 
  check ((tmdb_id is not null) or (internal_id is not null));

-- Add unique indexes that act as the conflict target for UPSERT
create unique index if not exists user_media_library_tmdb_unique 
  on public.user_media_library (user_id, list_kind, media_type, tmdb_id) 
  where (tmdb_id is not null);

create unique index if not exists user_media_library_internal_unique 
  on public.user_media_library (user_id, list_kind, media_type, internal_id) 
  where (internal_id is not null);

-- 2. Update user_watch_history
alter table public.user_watch_history add column if not exists internal_id uuid;
alter table public.user_watch_history alter column tmdb_id drop not null;

-- Drop existing composite primary key
alter table public.user_watch_history drop constraint if exists user_watch_history_pkey;

-- Add checking constraint
alter table public.user_watch_history add constraint user_watch_history_id_presence 
  check ((tmdb_id is not null) or (internal_id is not null));

-- Add unique indexes
create unique index if not exists user_watch_history_tmdb_unique 
  on public.user_watch_history (user_id, media_type, tmdb_id) 
  where (tmdb_id is not null);

create unique index if not exists user_watch_history_internal_unique 
  on public.user_watch_history (user_id, media_type, internal_id) 
  where (internal_id is not null);

commit;

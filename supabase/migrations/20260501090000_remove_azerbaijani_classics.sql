-- Removes the custom Azerbaijani Classics storage-backed catalog.
-- This migration is intentionally destructive; review before applying remotely.
-- It is safe to rerun after migration-history repair because deletes/drops are idempotent.

begin;

delete from public.user_media_library
where internal_id is not null;

delete from public.user_watch_history
where internal_id is not null;

drop table if exists public.az_classic_crew cascade;
drop table if exists public.az_classic_cast cascade;
drop table if exists public.az_classic_movies cascade;

commit;

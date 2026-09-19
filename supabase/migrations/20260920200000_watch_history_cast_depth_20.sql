-- Let a watch-history row hold the full billed cast the app keeps locally.
--
-- Entries remember 20 cast members (WATCH_ENTRY_CAST_LIMIT) so Stats can credit
-- an ensemble lead — Cate Blanchett is billed 13th on The Fellowship of the
-- Ring. The table capped cast_ids at 5, so every upload was truncated and any
-- device hydrating from the cloud fell back to five names per title until a
-- full local refetch finished. Raising the cap to 20 makes the round-trip
-- lossless; the parallel-array cardinality checks are unchanged.

alter table public.user_watch_history
  drop constraint if exists user_watch_history_cast_ids_check;

alter table public.user_watch_history
  add constraint user_watch_history_cast_ids_check check (cardinality(cast_ids) <= 20);

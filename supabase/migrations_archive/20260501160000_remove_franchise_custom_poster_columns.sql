-- Removes custom franchise poster/logo URL columns from the runtime schema.
-- Franchise artwork now resolves from TMDB or local rendered collection artwork.
-- Safe if the columns were already removed manually or by a previous partial cleanup.

begin;

alter table public.franchise_collections
  drop column if exists logo_url;

alter table public.franchise_entries
  drop column if exists poster_url;

commit;

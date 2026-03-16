create table if not exists public.external_ratings_cache (
  imdb_id text primary key,
  imdb_rating text,
  rotten_tomatoes text,
  metacritic text,
  raw_payload jsonb,
  fetched_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  last_accessed_at timestamptz not null default timezone('utc', now()),
  last_error text
);

create index if not exists external_ratings_cache_expires_at_idx
  on public.external_ratings_cache (expires_at);

alter table public.external_ratings_cache enable row level security;

revoke all on public.external_ratings_cache from anon;
revoke all on public.external_ratings_cache from authenticated;

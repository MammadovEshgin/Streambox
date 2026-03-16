-- Remote provider URL configuration for streaming sources.
-- Allows updating domain URLs without shipping an app update.

create table if not exists public.provider_configs (
  id          text primary key,           -- e.g. 'hdfilm', 'dizipal'
  label       text not null,              -- human-readable name
  base_url    text not null,              -- current active base URL
  referer     text not null default '',   -- Referer header value (if needed)
  enabled     boolean not null default true,
  priority    smallint not null default 0, -- lower = tried first
  updated_at  timestamptz not null default now(),
  notes       text                        -- optional admin notes
);

-- Seed with current known URLs
insert into public.provider_configs (id, label, base_url, referer, enabled, priority, notes)
values
  ('hdfilm',  'HDFilmCehennemi', 'https://www.hdfilmcehennemi.nl', 'https://www.hdfilmcehennemi.nl/', true, 0, 'Primary source – tried first'),
  ('dizipal', 'Dizipal',         'https://dizipal2031.com',        'https://dizipal2031.com/',        true, 1, 'Fallback source')
on conflict (id) do nothing;

-- Auto-update the updated_at column on changes
create or replace function public.provider_configs_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_provider_configs_updated_at on public.provider_configs;
create trigger trg_provider_configs_updated_at
  before update on public.provider_configs
  for each row
  execute function public.provider_configs_set_updated_at();

-- RLS: anyone can read, only service_role can write
alter table public.provider_configs enable row level security;

drop policy if exists "provider_configs_read" on public.provider_configs;
create policy "provider_configs_read"
  on public.provider_configs for select
  using (true);

-- Revoke direct insert/update/delete from anon and authenticated
revoke insert, update, delete on public.provider_configs from anon;
revoke insert, update, delete on public.provider_configs from authenticated;

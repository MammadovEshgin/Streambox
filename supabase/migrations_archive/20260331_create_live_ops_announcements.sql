create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  priority integer not null default 100,
  is_active boolean not null default true,
  requires_auth boolean not null default false,
  display_version integer not null default 1,
  title_en text not null,
  title_tr text,
  body_en text not null,
  body_tr text,
  eyebrow_en text,
  eyebrow_tr text,
  cta_label_en text,
  cta_label_tr text,
  cta_url text,
  image_url text,
  accent_hex text,
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  min_app_version text,
  max_app_version text,
  platforms text[] not null default array['android', 'ios']::text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (char_length(btrim(slug)) between 1 and 120),
  check (priority between 0 and 10000),
  check (display_version >= 1),
  check (char_length(btrim(title_en)) between 1 and 120),
  check (char_length(body_en) between 1 and 1200),
  check (title_tr is null or char_length(btrim(title_tr)) between 1 and 120),
  check (body_tr is null or char_length(body_tr) between 1 and 1200),
  check (eyebrow_en is null or char_length(btrim(eyebrow_en)) between 1 and 80),
  check (eyebrow_tr is null or char_length(btrim(eyebrow_tr)) between 1 and 80),
  check (cta_label_en is null or char_length(btrim(cta_label_en)) between 1 and 40),
  check (cta_label_tr is null or char_length(btrim(cta_label_tr)) between 1 and 40),
  check (accent_hex is null or accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.user_announcement_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.app_announcements(id) on delete cascade,
  display_version integer not null default 1,
  seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, announcement_id, display_version),
  check (display_version >= 1)
);

create index if not exists app_announcements_active_priority_idx
  on public.app_announcements (is_active, priority desc, starts_at desc);

create index if not exists user_announcement_views_lookup_idx
  on public.user_announcement_views (user_id, seen_at desc);

drop trigger if exists set_app_announcements_updated_at on public.app_announcements;
create trigger set_app_announcements_updated_at
  before update on public.app_announcements
  for each row execute function public.set_updated_at();

alter table public.app_announcements enable row level security;
alter table public.user_announcement_views enable row level security;

revoke all on public.app_announcements from anon;
revoke all on public.app_announcements from authenticated;
revoke all on public.user_announcement_views from anon;
revoke all on public.user_announcement_views from authenticated;

grant select on public.app_announcements to anon;
grant select on public.app_announcements to authenticated;
grant select, insert on public.user_announcement_views to authenticated;

drop policy if exists "app_announcements_public_read" on public.app_announcements;
create policy "app_announcements_public_read"
  on public.app_announcements
  for select
  to anon, authenticated
  using (
    is_active = true
    and starts_at <= timezone('utc', now())
    and (ends_at is null or ends_at > timezone('utc', now()))
  );

drop policy if exists "user_announcement_views_select_own" on public.user_announcement_views;
create policy "user_announcement_views_select_own"
  on public.user_announcement_views
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_announcement_views_insert_own" on public.user_announcement_views;
create policy "user_announcement_views_insert_own"
  on public.user_announcement_views
  for insert
  to authenticated
  with check (user_id = auth.uid());

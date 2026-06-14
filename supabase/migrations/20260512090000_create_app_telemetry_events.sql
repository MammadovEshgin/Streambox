create table if not exists public.app_telemetry_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  session_id text not null,
  event_name text not null,
  event_category text not null,
  severity text not null default 'info',
  metadata jsonb not null default '{}'::jsonb,
  platform text,
  app_version text,
  build_channel text,
  occurred_at timestamptz not null default now(),
  inserted_at timestamptz not null default now(),
  constraint app_telemetry_event_name_length check (char_length(event_name) between 2 and 120),
  constraint app_telemetry_session_id_length check (char_length(session_id) between 8 and 80),
  constraint app_telemetry_category_check check (event_category in ('app', 'crash', 'network', 'performance', 'supabase', 'tmdb')),
  constraint app_telemetry_severity_check check (severity in ('debug', 'info', 'warning', 'error', 'fatal')),
  constraint app_telemetry_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists app_telemetry_events_inserted_idx
  on public.app_telemetry_events (inserted_at desc);

create index if not exists app_telemetry_events_category_inserted_idx
  on public.app_telemetry_events (event_category, inserted_at desc);

create index if not exists app_telemetry_events_name_inserted_idx
  on public.app_telemetry_events (event_name, inserted_at desc);

create index if not exists app_telemetry_events_user_inserted_idx
  on public.app_telemetry_events (user_id, inserted_at desc);

alter table public.app_telemetry_events enable row level security;

revoke all on public.app_telemetry_events from anon;
revoke all on public.app_telemetry_events from authenticated;
grant insert on public.app_telemetry_events to authenticated;

drop policy if exists "app_telemetry_events_insert_own" on public.app_telemetry_events;
create policy "app_telemetry_events_insert_own"
  on public.app_telemetry_events
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

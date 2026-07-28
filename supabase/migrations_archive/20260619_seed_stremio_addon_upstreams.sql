-- Tier-3 provider: dizibal (dizibal.com). Different site than Dizipal —
-- clean REST API at /api/series, /api/movies, /api/stream/m3u8 returning
-- m3u8 URLs on commercial CDN77 infrastructure (uk-traffic-076) that
-- doesn't appear on Azerbaijani ISP block lists. The on-device scraper
-- in src/services/WebPlayerService.ts (resolveDizibalStream) reads this
-- row via providerConfigService; the Telegram bot rotates it via
-- /set_dizibal when the host moves, identical pattern to /set_dizipal.

-- Roll back the prior stremio-addon seed (vidsrc + embedsu); both have
-- been removed from the app. Safe to run repeatedly.
delete from public.provider_configs where id in ('vidsrc', 'embedsu');

insert into public.provider_configs (id, label, base_url, referer, enabled, priority, notes)
values
  ('dizibal', 'Dizibal', 'https://dizibal.com', 'https://dizibal.com/', true, 2, 'Tier-3 direct scraper — fallback when Dizipal CDN fails')
on conflict (id) do update set
  base_url = excluded.base_url,
  referer = excluded.referer,
  enabled = excluded.enabled,
  priority = excluded.priority,
  notes = excluded.notes;

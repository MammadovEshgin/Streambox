-- Update Dizipal to the currently working AJAX/search host.

update public.provider_configs
set
  base_url = 'https://dizipal2070.com',
  referer = 'https://dizipal2070.com/',
  notes = 'Fallback source - updated after link check on 2026-05-13'
where id = 'dizipal';

do $$
declare
  bond_collection_id uuid;
begin
  select id
    into bond_collection_id
    from public.franchise_collections
    where slug = 'james-bond-collection'
    limit 1;

  if bond_collection_id is null then
    return;
  end if;

  update public.franchise_entries entry
     set note = notes.description
    from (
      values
        (10764::bigint, 'Quantum of Solace'::text, 2008::integer, 'Bond follows the trail of Vesper''s betrayal into a powerful organization manipulating global resources.'::text),
        (37724::bigint, 'Skyfall'::text, 2012::integer, 'Bond returns from the shadows to protect M when a former MI6 operative brings the agency under attack.'::text),
        (206647::bigint, 'Spectre'::text, 2015::integer, 'A cryptic message sends Bond into the heart of a criminal network with ties to his own past.'::text),
        (370172::bigint, 'No Time to Die'::text, 2021::integer, 'Bond is pulled out of retirement to rescue a kidnapped scientist and face a weapon that changes everything.'::text)
    ) as notes(tmdb_id, title, year, description)
    where entry.franchise_id = bond_collection_id
      and (
        entry.tmdb_id = notes.tmdb_id
        or (
          lower(btrim(entry.title)) = lower(notes.title)
          and entry.year = notes.year
        )
      );
end $$;

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

  delete from public.franchise_entries
    where franchise_id = bond_collection_id
      and (
        tmdb_id = 36670
        or (
          lower(btrim(title)) = 'never say never again'
          and year = 1983
        )
      );

  update public.franchise_collections
     set total_entries = (
       select count(*)
         from public.franchise_entries
         where franchise_id = bond_collection_id
     )
   where id = bond_collection_id;
end $$;

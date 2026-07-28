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

  -- Move every current Bond row to a temporary range first. The table has a
  -- unique (franchise_id, watch_order) constraint, so this prevents transient
  -- collisions while we rebuild the official order.
  with moved as (
    select
      existing.id,
      100000 + row_number() over (
        order by existing.watch_order, existing.year nulls last, existing.title, existing.id
      ) as temp_order
      from public.franchise_entries existing
      where existing.franchise_id = bond_collection_id
  )
  update public.franchise_entries existing
     set watch_order = moved.temp_order
    from moved
    where existing.id = moved.id;

  -- Keep only one row for each official film if manual edits or failed retries
  -- left duplicate official entries behind.
  with desired(tmdb_id, title, year, watch_order) as (
    values
      (646::bigint, 'Dr. No'::text, 1962::integer, 1::integer),
      (657::bigint, 'From Russia with Love'::text, 1963::integer, 2::integer),
      (658::bigint, 'Goldfinger'::text, 1964::integer, 3::integer),
      (660::bigint, 'Thunderball'::text, 1965::integer, 4::integer),
      (667::bigint, 'You Only Live Twice'::text, 1967::integer, 5::integer),
      (668::bigint, 'On Her Majesty''s Secret Service'::text, 1969::integer, 6::integer),
      (681::bigint, 'Diamonds Are Forever'::text, 1971::integer, 7::integer),
      (253::bigint, 'Live and Let Die'::text, 1973::integer, 8::integer),
      (682::bigint, 'The Man with the Golden Gun'::text, 1974::integer, 9::integer),
      (691::bigint, 'The Spy Who Loved Me'::text, 1977::integer, 10::integer),
      (698::bigint, 'Moonraker'::text, 1979::integer, 11::integer),
      (699::bigint, 'For Your Eyes Only'::text, 1981::integer, 12::integer),
      (700::bigint, 'Octopussy'::text, 1983::integer, 13::integer),
      (707::bigint, 'A View to a Kill'::text, 1985::integer, 14::integer),
      (708::bigint, 'The Living Daylights'::text, 1987::integer, 15::integer),
      (709::bigint, 'Licence to Kill'::text, 1989::integer, 16::integer),
      (710::bigint, 'GoldenEye'::text, 1995::integer, 17::integer),
      (714::bigint, 'Tomorrow Never Dies'::text, 1997::integer, 18::integer),
      (36643::bigint, 'The World Is Not Enough'::text, 1999::integer, 19::integer),
      (36669::bigint, 'Die Another Day'::text, 2002::integer, 20::integer),
      (36557::bigint, 'Casino Royale'::text, 2006::integer, 21::integer),
      (10764::bigint, 'Quantum of Solace'::text, 2008::integer, 22::integer),
      (37724::bigint, 'Skyfall'::text, 2012::integer, 23::integer),
      (206647::bigint, 'Spectre'::text, 2015::integer, 24::integer),
      (370172::bigint, 'No Time to Die'::text, 2021::integer, 25::integer)
  ),
  ranked as (
    select
      existing.id,
      row_number() over (
        partition by desired.watch_order
        order by
          case when existing.tmdb_id = desired.tmdb_id then 0 else 1 end,
          existing.watch_order,
          existing.id
      ) as duplicate_rank
      from public.franchise_entries existing
      join desired
        on existing.franchise_id = bond_collection_id
       and (
         existing.tmdb_id = desired.tmdb_id
         or (
           lower(btrim(existing.title)) = lower(desired.title)
           and existing.year = desired.year
         )
       )
  )
  delete from public.franchise_entries existing
    using ranked
    where existing.id = ranked.id
      and ranked.duplicate_rank > 1;

  -- Insert official films that are still missing.
  with desired(tmdb_id, title, year, watch_order, phase) as (
    values
      (646::bigint, 'Dr. No'::text, 1962::integer, 1::integer, 'Sean Connery era'::text),
      (657::bigint, 'From Russia with Love'::text, 1963::integer, 2::integer, 'Sean Connery era'::text),
      (658::bigint, 'Goldfinger'::text, 1964::integer, 3::integer, 'Sean Connery era'::text),
      (660::bigint, 'Thunderball'::text, 1965::integer, 4::integer, 'Sean Connery era'::text),
      (667::bigint, 'You Only Live Twice'::text, 1967::integer, 5::integer, 'Sean Connery era'::text),
      (668::bigint, 'On Her Majesty''s Secret Service'::text, 1969::integer, 6::integer, 'George Lazenby era'::text),
      (681::bigint, 'Diamonds Are Forever'::text, 1971::integer, 7::integer, 'Sean Connery era'::text),
      (253::bigint, 'Live and Let Die'::text, 1973::integer, 8::integer, 'Roger Moore era'::text),
      (682::bigint, 'The Man with the Golden Gun'::text, 1974::integer, 9::integer, 'Roger Moore era'::text),
      (691::bigint, 'The Spy Who Loved Me'::text, 1977::integer, 10::integer, 'Roger Moore era'::text),
      (698::bigint, 'Moonraker'::text, 1979::integer, 11::integer, 'Roger Moore era'::text),
      (699::bigint, 'For Your Eyes Only'::text, 1981::integer, 12::integer, 'Roger Moore era'::text),
      (700::bigint, 'Octopussy'::text, 1983::integer, 13::integer, 'Roger Moore era'::text),
      (707::bigint, 'A View to a Kill'::text, 1985::integer, 14::integer, 'Roger Moore era'::text),
      (708::bigint, 'The Living Daylights'::text, 1987::integer, 15::integer, 'Timothy Dalton era'::text),
      (709::bigint, 'Licence to Kill'::text, 1989::integer, 16::integer, 'Timothy Dalton era'::text),
      (710::bigint, 'GoldenEye'::text, 1995::integer, 17::integer, 'Pierce Brosnan era'::text),
      (714::bigint, 'Tomorrow Never Dies'::text, 1997::integer, 18::integer, 'Pierce Brosnan era'::text),
      (36643::bigint, 'The World Is Not Enough'::text, 1999::integer, 19::integer, 'Pierce Brosnan era'::text),
      (36669::bigint, 'Die Another Day'::text, 2002::integer, 20::integer, 'Pierce Brosnan era'::text),
      (36557::bigint, 'Casino Royale'::text, 2006::integer, 21::integer, 'Daniel Craig era'::text),
      (10764::bigint, 'Quantum of Solace'::text, 2008::integer, 22::integer, 'Daniel Craig era'::text),
      (37724::bigint, 'Skyfall'::text, 2012::integer, 23::integer, 'Daniel Craig era'::text),
      (206647::bigint, 'Spectre'::text, 2015::integer, 24::integer, 'Daniel Craig era'::text),
      (370172::bigint, 'No Time to Die'::text, 2021::integer, 25::integer, 'Daniel Craig era'::text)
  ),
  missing as (
    select
      desired.*,
      200000 + row_number() over (order by desired.watch_order) as temp_order
      from desired
      where not exists (
        select 1
          from public.franchise_entries existing
          where existing.franchise_id = bond_collection_id
            and (
              existing.tmdb_id = desired.tmdb_id
              or (
                lower(btrim(existing.title)) = lower(desired.title)
                and existing.year = desired.year
              )
            )
      )
  )
  insert into public.franchise_entries (
    franchise_id,
    tmdb_id,
    media_type,
    title,
    year,
    watch_order,
    phase,
    tagline,
    note,
    runtime_minutes,
    episode_count,
    is_released
  )
  select
    bond_collection_id,
    missing.tmdb_id,
    'movie',
    missing.title,
    missing.year,
    missing.temp_order,
    missing.phase,
    null,
    null,
    null,
    null,
    true
    from missing;

  -- Place the official 25-film sequence.
  with desired(tmdb_id, title, year, watch_order, phase) as (
    values
      (646::bigint, 'Dr. No'::text, 1962::integer, 1::integer, 'Sean Connery era'::text),
      (657::bigint, 'From Russia with Love'::text, 1963::integer, 2::integer, 'Sean Connery era'::text),
      (658::bigint, 'Goldfinger'::text, 1964::integer, 3::integer, 'Sean Connery era'::text),
      (660::bigint, 'Thunderball'::text, 1965::integer, 4::integer, 'Sean Connery era'::text),
      (667::bigint, 'You Only Live Twice'::text, 1967::integer, 5::integer, 'Sean Connery era'::text),
      (668::bigint, 'On Her Majesty''s Secret Service'::text, 1969::integer, 6::integer, 'George Lazenby era'::text),
      (681::bigint, 'Diamonds Are Forever'::text, 1971::integer, 7::integer, 'Sean Connery era'::text),
      (253::bigint, 'Live and Let Die'::text, 1973::integer, 8::integer, 'Roger Moore era'::text),
      (682::bigint, 'The Man with the Golden Gun'::text, 1974::integer, 9::integer, 'Roger Moore era'::text),
      (691::bigint, 'The Spy Who Loved Me'::text, 1977::integer, 10::integer, 'Roger Moore era'::text),
      (698::bigint, 'Moonraker'::text, 1979::integer, 11::integer, 'Roger Moore era'::text),
      (699::bigint, 'For Your Eyes Only'::text, 1981::integer, 12::integer, 'Roger Moore era'::text),
      (700::bigint, 'Octopussy'::text, 1983::integer, 13::integer, 'Roger Moore era'::text),
      (707::bigint, 'A View to a Kill'::text, 1985::integer, 14::integer, 'Roger Moore era'::text),
      (708::bigint, 'The Living Daylights'::text, 1987::integer, 15::integer, 'Timothy Dalton era'::text),
      (709::bigint, 'Licence to Kill'::text, 1989::integer, 16::integer, 'Timothy Dalton era'::text),
      (710::bigint, 'GoldenEye'::text, 1995::integer, 17::integer, 'Pierce Brosnan era'::text),
      (714::bigint, 'Tomorrow Never Dies'::text, 1997::integer, 18::integer, 'Pierce Brosnan era'::text),
      (36643::bigint, 'The World Is Not Enough'::text, 1999::integer, 19::integer, 'Pierce Brosnan era'::text),
      (36669::bigint, 'Die Another Day'::text, 2002::integer, 20::integer, 'Pierce Brosnan era'::text),
      (36557::bigint, 'Casino Royale'::text, 2006::integer, 21::integer, 'Daniel Craig era'::text),
      (10764::bigint, 'Quantum of Solace'::text, 2008::integer, 22::integer, 'Daniel Craig era'::text),
      (37724::bigint, 'Skyfall'::text, 2012::integer, 23::integer, 'Daniel Craig era'::text),
      (206647::bigint, 'Spectre'::text, 2015::integer, 24::integer, 'Daniel Craig era'::text),
      (370172::bigint, 'No Time to Die'::text, 2021::integer, 25::integer, 'Daniel Craig era'::text)
  )
  update public.franchise_entries existing
     set tmdb_id = desired.tmdb_id,
         title = desired.title,
         year = desired.year,
         watch_order = desired.watch_order,
         phase = desired.phase,
         media_type = 'movie',
         is_released = true
    from desired
    where existing.franchise_id = bond_collection_id
      and (
        existing.tmdb_id = desired.tmdb_id
        or (
          lower(btrim(existing.title)) = lower(desired.title)
          and existing.year = desired.year
        )
      );

  -- Preserve non-official/extras, but place them after the official sequence.
  with extras as (
    select
      existing.id,
      25 + row_number() over (
        order by existing.year nulls last, existing.title, existing.id
      ) as final_order
      from public.franchise_entries existing
      where existing.franchise_id = bond_collection_id
        and existing.watch_order >= 100000
  )
  update public.franchise_entries existing
     set watch_order = extras.final_order
    from extras
    where existing.id = extras.id;

  update public.franchise_collections
     set total_entries = (
       select count(*)
         from public.franchise_entries
         where franchise_id = bond_collection_id
     )
   where id = bond_collection_id;
end $$;

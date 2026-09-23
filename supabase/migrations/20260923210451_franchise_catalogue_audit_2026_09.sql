-- Franchise catalogue audit, 2026-09-24.
--
-- 1. Titles: an early import stripped every colon and ampersand, so 55 entries
--    read "Mission Impossible - Fallout" and "Fast  Furious 6". Restored to the
--    canonical spelling. The Star Wars films keep their episode numbering on
--    purpose — the timeline reads in saga order, which TMDB's short names lose.
-- 2. Facts: two entries had no tmdb_id at all (no poster, nothing to play),
--    three series were stuck at their first season's episode count, and a dozen
--    rows were missing a runtime.
-- 3. Additions: 17 titles released (or announced) since the catalogue was built,
--    including the Harry Potter series, The Mandalorian and Grogu, The Fantastic
--    4: First Steps and The Ballad of Songbirds & Snakes.

begin;

-- ── 1. Punctuation restored ──────────────────────────────────────────────
update public.franchise_entries set title = 'The Hunger Games: Catching Fire' where id = '7eebfbce-afd5-481e-8895-8d28e19f5598';
update public.franchise_entries set title = 'The Hunger Games: Mockingjay - Part 1' where id = '772a28c9-64a7-4f71-9ea0-89a5b15525c0';
update public.franchise_entries set title = 'The Hunger Games: Mockingjay - Part 2' where id = '9bf4ce9e-1a2c-4612-ad53-9390b9d1d27f';
update public.franchise_entries set title = 'John Wick: Chapter 2' where id = 'bd4a6f5f-8286-48a5-9bd8-ecd009765606';
update public.franchise_entries set title = 'John Wick: Chapter 3 - Parabellum' where id = 'f7ac4302-115d-44ab-959c-5f9f0c8dab19';
update public.franchise_entries set title = 'John Wick: Chapter 4' where id = '6f6f8ffb-afce-4868-b1e5-f6a8b9a25221';
update public.franchise_entries set title = 'Batman v Superman: Dawn of Justice' where id = '0a99ff3c-e6d6-481a-9a27-25f1024c15eb';
update public.franchise_entries set title = 'Joker: Folie à Deux' where id = 'bb055c82-f54a-474a-863b-b431cdd7fd9d';
update public.franchise_entries set title = 'Mission: Impossible' where id = 'd4cbdb12-84a8-46db-9eeb-bcab584f0e89';
update public.franchise_entries set title = 'Mission: Impossible II' where id = '8e92ba47-2c56-4633-9ed5-8c4c85546ee0';
update public.franchise_entries set title = 'Mission: Impossible III' where id = 'b57598d2-cc58-45e9-ae18-d4bacbd21f2f';
update public.franchise_entries set title = 'Mission: Impossible - Ghost Protocol' where id = 'c3797fe3-a53b-492e-a7a3-4d1b027c8eda';
update public.franchise_entries set title = 'Mission: Impossible - Rogue Nation' where id = 'e7cfa209-246b-49c4-8d52-06756a6ae007';
update public.franchise_entries set title = 'Mission: Impossible - Fallout' where id = 'd4991922-3741-4670-b2a5-b935a0dffb8a';
update public.franchise_entries set title = 'Mission: Impossible - Dead Reckoning Part One' where id = '96ef2eba-e289-4ab8-8808-a500fb8285bf';
update public.franchise_entries set title = 'Mission: Impossible - The Final Reckoning' where id = 'c3d20003-94ec-479d-81d9-99818fd8158c';
update public.franchise_entries set title = 'X-Men: The Last Stand' where id = '966b8723-3c99-45f2-9ed8-0288494f8691';
update public.franchise_entries set title = 'X-Men Origins: Wolverine' where id = '4222ef90-56de-46d8-9a04-aa4f6c0688a6';
update public.franchise_entries set title = 'X-Men: First Class' where id = 'd5283c28-d919-4b9f-a401-d50e5a8d234a';
update public.franchise_entries set title = 'X-Men: Days of Future Past' where id = 'c84e67db-9ddb-4ebc-a7de-153bcc5b59eb';
update public.franchise_entries set title = 'X-Men: Apocalypse' where id = 'ba32884c-f5ce-4697-a7b4-6e900f09322d';
update public.franchise_entries set title = 'Transformers: Revenge of the Fallen' where id = '2adb8a9e-131d-4ec0-a04f-781ede7791c9';
update public.franchise_entries set title = 'Transformers: Dark of the Moon' where id = 'ba8c9c2c-5eb7-4ae7-a947-b147d8cc6860';
update public.franchise_entries set title = 'Transformers: Age of Extinction' where id = 'b654d126-6138-4772-94ed-5facca89bdae';
update public.franchise_entries set title = 'Transformers: The Last Knight' where id = 'be407e76-fcd6-4ce7-8a70-c41f1a5a5e39';
update public.franchise_entries set title = 'Transformers: Rise of the Beasts' where id = 'cee83aea-1286-4b24-8df8-d7286e4f8871';
update public.franchise_entries set title = 'The Hobbit: An Unexpected Journey' where id = '2d692be1-21b2-4297-bf3c-7a5404f90127';
update public.franchise_entries set title = 'The Hobbit: The Desolation of Smaug' where id = '4d608164-ef5d-4345-97f6-dfd7459a83e0';
update public.franchise_entries set title = 'The Hobbit: The Battle of the Five Armies' where id = '0ef6060d-e181-4e79-87b2-3efdc5df0fb4';
update public.franchise_entries set title = 'The Lord of the Rings: The Fellowship of the Ring' where id = '8990b51b-9f1a-40f5-aaf4-3d8aa0197012';
update public.franchise_entries set title = 'The Lord of the Rings: The Two Towers' where id = '913dfa58-d6f4-4793-b0f4-ef70e0fdaba2';
update public.franchise_entries set title = 'The Lord of the Rings: The Return of the King' where id = 'ae63112f-9914-4ad7-b79d-1d24fb67ee08';
update public.franchise_entries set title = 'The Fast and the Furious: Tokyo Drift' where id = '532973e8-3008-468f-8403-8ecf01b0137c';
update public.franchise_entries set title = 'Fast & Furious' where id = '3260e2b8-dc39-4245-829d-a167f80054f2';
update public.franchise_entries set title = 'Fast & Furious 6' where id = 'ca27b531-4785-4570-8f44-8e44f8913dce';
update public.franchise_entries set title = 'Fast & Furious Presents: Hobbs & Shaw' where id = '5acbdaf8-ef69-457b-9bd2-37c376d4feb5';
update public.franchise_entries set title = 'The Twilight Saga: New Moon' where id = '2e6f92bf-a8a3-4897-825e-5b88b64dc281';
update public.franchise_entries set title = 'The Twilight Saga: Eclipse' where id = '5994ec8c-fb9a-4f52-a4b3-a0054dc64387';
update public.franchise_entries set title = 'The Twilight Saga: Breaking Dawn - Part 1' where id = '635301d0-97e5-43ed-b186-bb205d6ef03f';
update public.franchise_entries set title = 'The Twilight Saga: Breaking Dawn - Part 2' where id = '73175ad0-12a0-4494-a5c3-cabbfaf276b4';
update public.franchise_entries set title = 'Insidious: Chapter 2' where id = 'db0f7758-463d-44a7-a951-b131eb488dd3';
update public.franchise_entries set title = 'Insidious: Chapter 3' where id = 'df1d04f8-51e9-4640-8c05-6b834e40613e';
update public.franchise_entries set title = 'Insidious: The Last Key' where id = '2c156355-2172-415e-9da1-36ed274c34b3';
update public.franchise_entries set title = 'Insidious: The Red Door' where id = 'bb296615-8ea5-41cc-9a1a-e3be4c06feb9';
update public.franchise_entries set title = 'The Lost World: Jurassic Park' where id = '07ecf9f3-9023-4147-b5e6-358b8609655f';
update public.franchise_entries set title = 'Jurassic World: Fallen Kingdom' where id = '907e4927-996d-4fb5-968d-2e4167cd6e9b';
update public.franchise_entries set title = 'Star Wars: Skeleton Crew' where id = 'f3716255-5b92-4c28-92fe-7ce7e8320ad7';
update public.franchise_entries set title = 'Spiral: From the Book of Saw' where id = 'a107a128-4ea0-435e-bdab-64d0ad3da365';
update public.franchise_entries set title = 'Dune: Part Two' where id = 'ff9288b4-6f28-44da-918d-c02afea012eb';
update public.franchise_entries set title = 'Dune: Prophecy' where id = '246868ff-28c7-4339-a981-b705885de768';
update public.franchise_entries set title = 'Harry Potter and the Philosopher''s Stone' where id = 'e6e38a07-652f-408b-97d5-59167169372e';
update public.franchise_entries set title = 'Harry Potter and the Deathly Hallows: Part 1' where id = '85f263af-48dd-4d65-b922-3578fb8ddd9f';
update public.franchise_entries set title = 'Harry Potter and the Deathly Hallows: Part 2' where id = '6069bc27-8a0c-4665-b4f4-e88d68796d49';
update public.franchise_entries set title = 'The Conjuring: The Devil Made Me Do It' where id = '4224662d-96f3-48e5-8ba8-0b832ebb1b74';
update public.franchise_entries set title = 'The Conjuring: Last Rites' where id = '864999dd-eaf0-49be-b17c-d32d21dfd6d4';

-- ── 2. Facts corrected against TMDB ──────────────────────────────────────
update public.franchise_entries set runtime_minutes = 123 where id = '330dd97f-d358-41cb-82f8-eda2d2d922c0';  -- Jason Bourne
update public.franchise_entries set episode_count = 27 where id = '54b296e5-cda3-4794-9b5e-677e0f05dcbf';  -- Legion
update public.franchise_entries set episode_count = 29 where id = '58d2bc50-dfe5-4bde-99c2-ab305ee042bb';  -- The Gifted
update public.franchise_entries set episode_count = 24 where id = 'da5c1723-adcd-40b8-8f55-d1aade51633a';  -- The Lord of the Rings: The Rings of Power
update public.franchise_entries set runtime_minutes = 106 where id = '8806af3a-e279-4e67-8743-fc349728f8b1';  -- Quantum of Solace
update public.franchise_entries set runtime_minutes = 143 where id = '341d4f09-897d-4570-b578-a041b977e97d';  -- Skyfall
update public.franchise_entries set runtime_minutes = 148 where id = 'f62dd658-13c0-4066-bd6c-07f4efbbc223';  -- Spectre
update public.franchise_entries set runtime_minutes = 163 where id = '8455fc81-e4d0-433c-9f25-1550f04a3fed';  -- No Time to Die
update public.franchise_entries set runtime_minutes = 138 where id = '76b89b63-b5b3-4b78-ad9a-2d1c8f628084';  -- Furious 7
update public.franchise_entries set tmdb_id = 507086, runtime_minutes = 147 where id = '7f174b7e-be5a-4be8-b760-69d4b8f74cee';  -- Jurassic World Dominion
update public.franchise_entries set episode_count = 16 where id = 'de063e24-9b9a-455c-b5ae-b3c6c237f924';  -- Ahsoka
update public.franchise_entries set runtime_minutes = 140 where id = '1ed6416e-5df8-4ab1-b4d7-827008ccc395';  -- Dune: Part Three
update public.franchise_entries set runtime_minutes = 114 where id = '173ecb2e-2959-404d-9a8f-70145e445576';  -- The Incredible Hulk
update public.franchise_entries set runtime_minutes = 135 where id = '1b6f3403-f612-4868-b758-b043cb84dc32';  -- Black Panther
update public.franchise_entries set runtime_minutes = 119 where id = '3c9d2005-4d3c-49f3-8e93-1bf9875ae329';  -- Ant-Man and the Wasp
update public.franchise_entries set episode_count = 26 where id = '79f199fd-5528-4213-a1a9-371ecf22017d';  -- What If...?
update public.franchise_entries set runtime_minutes = 156 where id = '601b31e4-2da3-4621-acb3-d1822fb008cc';  -- Eternals
update public.franchise_entries set runtime_minutes = 55 where id = 'ef13ffa2-0b87-4477-a907-5357e81e5cd5';  -- Werewolf by Night
update public.franchise_entries set runtime_minutes = 45 where id = '5382351e-f73d-49a3-ab24-5d392c5a94c7';  -- The Guardians of the Galaxy Holiday Special
update public.franchise_entries set runtime_minutes = 162 where id = '9bf7ab0c-92c5-4a54-830c-605e41e2c607';  -- Black Panther: Wakanda Forever
update public.franchise_entries set episode_count = 17 where id = 'd3f41399-16ee-45d3-84e6-7935d224bcf6';  -- Daredevil: Born Again
update public.franchise_entries set tmdb_id = 969681, is_released = true, runtime_minutes = 145 where id = '32399f43-74e0-4418-a752-b2e9e0e80aca';  -- Spider-Man: Brand New Day
update public.franchise_entries set runtime_minutes = 165 where id = '78d582cd-1688-48aa-b17a-832a9b8bd0b3';  -- Avengers: Doomsday
update public.franchise_entries set runtime_minutes = 112 where id = '46e23e25-5dfe-4afe-9a50-0e8bb205b9f3';  -- Scream

-- ── 3. Titles added ──────────────────────────────────────────────────────

-- MCU collection
update public.franchise_entries set watch_order = watch_order + 1000 where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and watch_order >= 48;
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select 'aaf535c4-2143-46b9-bdc6-8e54beef5b29', 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd', 138503, 'tv', 'Your Friendly Neighborhood Spider-Man', 2025, 48, 'Phase 5: The Kang Dynasty', 'Meet the new hero on the block.', null, null, 10, true
  where not exists (select 1 from public.franchise_entries where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and media_type = 'tv' and tmdb_id = 138503);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '73588beb-3c7b-448f-a396-117bd107d679', 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd', 617126, 'movie', 'The Fantastic 4: First Steps', 2025, 53, 'Phase 6: The Final Chapter', 'Welcome to the family.', null, 115, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and media_type = 'movie' and tmdb_id = 617126);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select 'aba93a33-4e57-4ac2-8658-1642e7c5cea2', 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd', 241388, 'tv', 'Eyes of Wakanda', 2025, 54, 'Phase 6: The Final Chapter', 'Every mission shapes a legacy.', null, null, 4, true
  where not exists (select 1 from public.franchise_entries where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and media_type = 'tv' and tmdb_id = 241388);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '9021b5ff-765b-4821-85ae-a63404ebc8fc', 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd', 138505, 'tv', 'Marvel Zombies', 2025, 55, 'Phase 6: The Final Chapter', 'Who will save us from our heroes?', null, null, 4, true
  where not exists (select 1 from public.franchise_entries where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and media_type = 'tv' and tmdb_id = 138505);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '8c59fbc3-96b6-4b91-953e-9c2aec5fbcea', 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd', 198178, 'tv', 'Wonder Man', 2026, 56, 'Phase 6: The Final Chapter', 'He was born to play this role, but the spotlight reveals everything.', null, null, 8, true
  where not exists (select 1 from public.franchise_entries where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and media_type = 'tv' and tmdb_id = 198178);
update public.franchise_entries
   set watch_order = watch_order - 1000 + (select count(*) from unnest(array[48, 52, 52, 52, 52]) as slot where slot <= watch_order - 1000)
 where franchise_id = 'c58f1051-99cf-4688-9ae3-d2baa2d1f1bd' and watch_order > 1000;

-- Star Wars Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '21254a48-95c7-4c84-a27f-a82178ebd77c', '92db404d-0d25-4557-98d3-87f0e1b0b90b', 1228710, 'movie', 'The Mandalorian and Grogu', 2026, 19, null, 'If you''re searching for new adventure, "this is the way."', null, 132, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = '92db404d-0d25-4557-98d3-87f0e1b0b90b' and media_type = 'movie' and tmdb_id = 1228710);

-- Harry Potter Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select 'a5576c32-59fc-4467-be9e-1c6a93bd8577', 'd7354372-7000-424d-90d1-9263ed2813b6', 224377, 'tv', 'Harry Potter', 2026, 12, null, null, null, null, null, false
  where not exists (select 1 from public.franchise_entries where franchise_id = 'd7354372-7000-424d-90d1-9263ed2813b6' and media_type = 'tv' and tmdb_id = 224377);

-- The Hunger Games Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '7df73479-7491-4beb-a19e-2776babce690', '14d9d6ff-8682-4783-9270-dc8cea4ee493', 695721, 'movie', 'The Hunger Games: The Ballad of Songbirds & Snakes', 2023, 5, null, 'Everyone hungers for something.', null, 157, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = '14d9d6ff-8682-4783-9270-dc8cea4ee493' and media_type = 'movie' and tmdb_id = 695721);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '7d3560a4-8244-4b8e-a331-91b5dc5bbf69', '14d9d6ff-8682-4783-9270-dc8cea4ee493', 1300968, 'movie', 'The Hunger Games: Sunrise on the Reaping', 2026, 6, null, 'Welcome to the Second Quarter Quell.', null, null, null, false
  where not exists (select 1 from public.franchise_entries where franchise_id = '14d9d6ff-8682-4783-9270-dc8cea4ee493' and media_type = 'movie' and tmdb_id = 1300968);

-- Middle-Earth Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '0df46e76-b8f8-4eda-8a61-04f793dc2f13', '42b265ff-ef76-4285-bb84-49c40b056d49', 839033, 'movie', 'The Lord of the Rings: The War of the Rohirrim', 2024, 8, null, 'Hope has yet to abandon these lands.', null, 134, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = '42b265ff-ef76-4285-bb84-49c40b056d49' and media_type = 'movie' and tmdb_id = 839033);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '5e992402-ca49-4d09-ba05-de009eb9204a', '42b265ff-ef76-4285-bb84-49c40b056d49', 1090869, 'movie', 'The Lord of the Rings: The Hunt for Gollum', 2027, 9, null, null, null, null, null, false
  where not exists (select 1 from public.franchise_entries where franchise_id = '42b265ff-ef76-4285-bb84-49c40b056d49' and media_type = 'movie' and tmdb_id = 1090869);

-- Transformers Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select 'f69ffc32-48d0-46b6-adb7-c80fa1df0d63', '3ba07d63-55d7-446e-97e9-f3cf159d2831', 698687, 'movie', 'Transformers One', 2024, 8, null, 'Witness the origin.', null, 104, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = '3ba07d63-55d7-446e-97e9-f3cf159d2831' and media_type = 'movie' and tmdb_id = 698687);

-- Insidious Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '2dd75382-c7bc-4572-a699-4ceee001fc71', '5aae490f-afb8-42fc-bd2e-6dcf6e5081c8', 1291595, 'movie', 'Insidious: Out of the Further', 2026, 6, null, 'Evil found a way out.', null, 106, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = '5aae490f-afb8-42fc-bd2e-6dcf6e5081c8' and media_type = 'movie' and tmdb_id = 1291595);

-- Dc collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '07bedb2e-574a-447d-9c1a-c7c1e7e63fe4', '195e6182-6258-4897-9297-d0e53fe464dd', 1081003, 'movie', 'Supergirl', 2026, 32, null, 'Truth. Justice. Whatever.', null, 108, null, true
  where not exists (select 1 from public.franchise_entries where franchise_id = '195e6182-6258-4897-9297-d0e53fe464dd' and media_type = 'movie' and tmdb_id = 1081003);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select 'd8f2d398-0070-42cf-a3ed-932fedf64239', '195e6182-6258-4897-9297-d0e53fe464dd', 1400940, 'movie', 'Clayface', 2026, 33, null, 'Look fear in the face.', null, 108, null, false
  where not exists (select 1 from public.franchise_entries where franchise_id = '195e6182-6258-4897-9297-d0e53fe464dd' and media_type = 'movie' and tmdb_id = 1400940);
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '30c6e154-916b-4747-9320-14c213286584', '195e6182-6258-4897-9297-d0e53fe464dd', 806704, 'movie', 'The Batman: Part II', 2028, 34, null, null, null, null, null, false
  where not exists (select 1 from public.franchise_entries where franchise_id = '195e6182-6258-4897-9297-d0e53fe464dd' and media_type = 'movie' and tmdb_id = 806704);

-- The Fast and the Furious Collection
insert into public.franchise_entries (id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released)
  select '416213c1-1da1-483b-b69d-5e4c82ff14c8', '5096e4c0-995e-44c8-950a-4647f4486db3', 755679, 'movie', 'Fast Forever', 2028, 12, null, null, null, null, null, false
  where not exists (select 1 from public.franchise_entries where franchise_id = '5096e4c0-995e-44c8-950a-4647f4486db3' and media_type = 'movie' and tmdb_id = 755679);

-- ── 4. Counters follow the rows ──────────────────────────────────────────
update public.franchise_collections c
   set total_entries = (select count(*) from public.franchise_entries e where e.franchise_id = c.id)
 where total_entries <> (select count(*) from public.franchise_entries e where e.franchise_id = c.id);

commit;

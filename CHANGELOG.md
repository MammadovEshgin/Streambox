# Changelog

Notable user-facing changes to StreamBox, newest first. The app updates over the air on
runtime **1.2.0**; update IDs and technical detail for each release are in
[`ENGINEERING.md`](ENGINEERING.md).

## 2026-09-20

- Fixed: most titles failed to play natively after both main providers changed their sites;
  episodes like "Mezarlık" showed "Not available" on the first tap and played on the second.
- Fixed: some titles (e.g. "Neagley") opened a provider's own web player. Playback now always
  uses the app's player; if a stream won't start, another provider is tried.
- Fixed: "Retry" on a playback error did nothing, and the error could stay hidden behind the
  loading screen. "Not available" now has a Try again.
- Fixed: new installs were greeted by old announcements (the June Letterboxd import notice).
- Fixed: new accounts started on the orange theme instead of green.

## 2026-09-18

- Fixed: slow Dizipal playback after the provider moved to a new domain.

## 2026-09-17

- Fixed: likes, watchlist and watch-history changes could silently fail to sync to your
  account; failed syncs now retry instead of being lost, even after time offline.
- Fixed: Watch Together calls on mobile data couldn't use the relay server, so some calls
  never connected video.
- Fixed: IMDb, Rotten Tomatoes and Metacritic ratings weren't loading on detail pages.
- Security: the fallback web player only trusts known provider sites, and feedback sending
  is rate-limited.

## 2026-09-15

- Fixed: Resident Evil (2026) played the 2002 film.
- Fixed: Stats still missed some actors' films (e.g. Cate Blanchett in The Lord of the Rings);
  the app also no longer slows down while that data refreshes.
- Fixed: Turkish posters and titles appearing in Watchlist and Liked under an English UI.
- Fixed: playback pausing for a couple of seconds on slow streams.
- Fixed: nothing loading on Bakcell mobile data.
- Improved: the launch logo no longer appears to freeze.

## 2026-09-14

- Fixed: slow Dizipal playback after the provider moved to a new domain.

## 2026-09-11

- Fixed: searching a film's full name (e.g. "harry potter") returned an actor's filmography.
- Fixed: search hid results that only matched a translated title.
- Fixed: titles with apostrophes (Rosemary's Baby, Ocean's Eleven) showed Not Available.
- Fixed: English films under a Turkish UI could fail to play.
- Changed: marking a title watched removes it from your watchlist.
- Fixed: Back from a See All grid jumped to Discover.
- Fixed: Stats' top actors missed films where the actor was billed lower down.
- Fixed: profile counts climbing in batches, and "Recently added" sorting oldest first.
- Fixed: content staying in the previous language right after switching language.
- Fixed: the Watch Together room-code field hidden behind the keyboard.

## 2026-09-10

- Fixed: Dizipal titles failing intermittently when the provider served security challenges,
  and slow requests after another domain change.

## 2026-09-08

- Fixed: HDFilm stopped playing entirely after a provider change; titles load in about a
  second again, usually with dual audio.
- Fixed: seeking or opening subtitles early could show "Not Available" or a black screen with
  audio.
- Fixed: correctly typed titles (including Turkish characters like "Mezarlık") missing from
  search.
- Fixed: Watch Together sometimes showed only one person's camera.

## 2026-09-02

- Fixed: Dizipal titles appeared in search but wouldn't play.
- Fixed: every play was slowed by an outdated Dizipal address.
- Fixed: HDFilm series fell back to Turkish-dub-only streams.

## 2026-08-10

- Fixed: films with non-Latin original titles (Harakiri, Oldboy, Parasite) showed Not Available.
- Fixed: a one-year date difference between sources rejected the right film.
- Fixed: audio tracks all labelled "Unknown", and the original soundtrack not being preferred.
- Changed: subtitles start off until you choose one.
- Fixed: Movie / Series of the Day stopped changing daily.

## 2026-08-02

- Added: audio track picker that defaults to the original soundtrack and remembers your choice.
- Fixed: HDFilm titles falling back to slower, dub-only providers.
- Fixed: Dizipal streams failing to start.
- Changed: playback always uses the app's own player instead of provider web players.
- Fixed: watched seasons not syncing and missing from your profile.

## July 2026

- Added: **Watch Together** — private two-person rooms with synced playback, face-cam and
  voice, chat, reactions and shared polaroid memories on both profiles (runtime 1.2.0).
- Added: auto-mark as watched, next-episode countdown and an in-player episode picker.
- Added: Azerbaijani Classics collection.
- Fixed: Dizibal streams stopped resolving; anime series now play.
- Improved: Watch Together reconnection, chat delivery and photo capture reliability.
- Improved: smoother launch splash with no black flash.

## Earlier

- 1.0.x: multi-provider stream resolution, native player, account sync with Supabase, taste
  profiles, franchise timelines, Movie / Series of the Day, silent over-the-air updates.

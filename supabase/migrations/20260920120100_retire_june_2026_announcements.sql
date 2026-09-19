-- Retire the two June 2026 announcements that are still active with no ends_at.
--
-- "Unseen" is decided per install and per account, so every fresh install was
-- greeted by these months-old popups (the Letterboxd import one first — it has
-- the highest priority). The client now also hides announcements that started
-- before the install unless they are a still-running time-boxed campaign; this
-- clears the two rows themselves. Publish future announcements with an ends_at.

update public.app_announcements
   set is_active = false,
       updated_at = timezone('utc', now())
 where slug in ('streambox-letterboxd-import-2026-06', 'streambox-june-2026-polish')
   and is_active;

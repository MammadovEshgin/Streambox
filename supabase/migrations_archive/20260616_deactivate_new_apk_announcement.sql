-- Deactivate the "New StreamBox APK Available" live announcement.
--
-- Why: the announcement was a one-off broadcast to drive existing users to
-- download the newer APK from streamboxapp.stream. Now that the APK on the
-- website IS the latest, the announcement has flipped from "useful nudge" to
-- "confusing popup that greets every fresh install" — the first thing a brand
-- new user sees on cold-launching the APK they just downloaded.
--
-- Deactivating it stops the popup for ALL users (new installs and existing
-- ones who haven't yet dismissed it). Users who already dismissed it have the
-- seen-state recorded locally + remotely so they were never going to see it
-- again anyway.
--
-- We update by slug rather than DELETE so the per-user view rows in
-- user_announcement_views stay valid and the seen-state history is preserved.
-- If we ever need a "new APK" announcement again, create a NEW slug rather
-- than reactivating this one.

update public.app_announcements
   set is_active = false,
       updated_at = timezone('utc', now())
 where slug = 'streambox-new-apk-download-2026-06';

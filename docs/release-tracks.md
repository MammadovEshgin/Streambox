# Release tracks (OTA runtime routing)

StreamBox ships on **three runtime versions**. An OTA (`eas update`) only
reaches apps whose `runtimeVersion` matches the one in `app.config.js` at the
moment you publish. **`runtimeVersion` is the source of truth** — always check
it before `eas update`.

| Track | `runtimeVersion` | Branch | Native modules | Must NOT contain |
|---|---|---|---|---|
| **Legacy fleet** | `1.0.2` | `release/1.0.2-legacy` | no `expo-navigation-bar` | nav-bar code (crashes these APKs) |
| **Nav-bar APK** | `1.1.0` | `release/1.1.0-navbar` | `expo-navigation-bar` | — |
| **Watch Together APK** (newest) | `1.2.0` | `v1.2.0` | + `react-native-webrtc`, camera | — |

## Fleet policy (since 2026-07-25)

New features target **only the newest runtime** (`1.2.0` / `v1.2.0`). Older
fleets get a shared OTA only for:

- provider / stream-source fixes, and
- critical crash or data-loss fixes.

This is why most batches ship to 1.2.0 alone. Publishing to an older track is a
deliberate decision, not the default.

> The planned `1.3.0` runtime (social platform + player autonomy) was abandoned
> on 2026-07-28. Social was dropped entirely; player autonomy was folded back
> into 1.2.0 as a JS-only OTA and the `v1.3.0` branch was deleted. Do not
> resurrect it.

## How to publish an OTA safely

1. Decide which fleet the change is for (see the policy above).
2. Check out the matching branch and confirm `app.config.js` → `runtimeVersion`
   matches the table. This is the step that actually routes the update.
3. Verify before shipping — `npm run typecheck && npm test`.
4. `npx eas-cli update --branch preview --message "..." --non-interactive`
   (it reads the local `runtimeVersion`; `preview` is the channel installed
   apps listen on).
5. Record the resulting group ID in `ENGINEERING.md` → "Current deployed state".

A change that must reach **everyone** has to be published once per branch — the
same JS work, but the `1.0.2` bundle has to stay nav-bar-free.

## Why the tracks are isolated

- `expo-navigation-bar` is a native module the `1.0.2` APKs don't ship; calling
  it there is a native crash on playback. That is why nav-bar code must never
  land on the legacy branch.
- `1.2.0` adds native WebRTC + camera for Watch Together. It is deliberately not
  ported back — the older APKs have no such native code to talk to.

Delivery on device: `src/services/appUpdateService.ts` polls every 5 minutes and
`src/components/common/LiveOpsHost.tsx` reloads silently on the next
background→foreground transition, suppressed during playback via
`isPlayerActive()`. There is intentionally no "Restart now" modal.

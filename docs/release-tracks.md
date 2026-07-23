# Release tracks (OTA runtime routing)

StreamBox currently ships on **two runtime versions**. An OTA (`eas update`)
only reaches apps whose `runtimeVersion` matches the one in `app.config.js` at
the moment you publish. **`runtimeVersion` is the source of truth** — always
check it before `eas update`.

| Track | `runtimeVersion` | Branch | Native modules | Must NOT contain |
|---|---|---|---|---|
| **Legacy fleet** (most installed users) | `1.0.2` | `feature/letterboxd-import`, `main` | no `expo-navigation-bar` | nav-bar code (crashes these APKs) |
| **Nav-bar APK** (new website download) | `1.1.0` | `release/navbar-apk` | `expo-navigation-bar` | — |

## How to publish an OTA safely

1. Decide which fleet the change is for.
2. Check out the matching branch and confirm `app.config.js` → `runtimeVersion`:
   - `1.0.2` → legacy fleet. The bundle **must be nav-bar-free**.
   - `1.1.0` → nav-bar APK only.
3. `eas update --branch preview --message "..."` (it reads the local
   `runtimeVersion`).

A change that should reach **everyone** has to be published **twice** — once
from the `1.0.2` branch and once from the `1.1.0` branch (same JS work, but the
`1.0.2` build keeps nav-bar code out).

## Where the nav-bar feature lives

Only on `release/navbar-apk` (the `1.1.0` track). It is deliberately kept off
the `1.0.2` track because `expo-navigation-bar` is a native module the legacy
APKs don't ship, and calling it there is a native crash on playback.

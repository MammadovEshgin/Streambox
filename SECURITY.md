# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in StreamBox, **please do not open a public GitHub issue.** Instead, email the maintainer at:

**esqinmemmedov700@gmail.com**

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal proof-of-concept is ideal).
- Any relevant logs, screenshots, or crash dumps — with sensitive values redacted.

You'll get an acknowledgement within **72 hours** and a triage outcome within **7 days**.

## Scope

In scope:

- The mobile app source in this repository (`src/`, `App.tsx`).
- The Cloudflare Workers (`workers/tmdb-proxy`, `workers/provider-monitor`, `workers/turn-credentials`).
- The Supabase functions in `supabase/functions/`.

Out of scope:

- Third-party content providers (HDFilmCehennemi, Dizipal, Dizibal) — these are external services the app integrates with.
- Vulnerabilities in transitive npm/Expo dependencies — please report those upstream and notify us if there's no available mitigation.
- Social-engineering attacks against the maintainer or users.

## Hardening Baseline

The project follows these practices, verified by the audit log:

- **No hardcoded secrets** — all credentials live in `.env` (gitignored), in Cloudflare Worker secret stores, or as Supabase Edge Function secrets.
- **OMDB API key kept server-side** — proxied through a Supabase function; never bundled into the mobile binary.
- **TMDB key behind a Cloudflare Worker** — `EXPO_PUBLIC_TMDB_API_KEY` / `_ACCESS_TOKEN` are local-dev fallbacks only.
- **Workers fail closed** — missing secrets return 401/503 instead of running open; TURN credentials are minted only for a signed-in user's verified token; CORS allows no browser origins by default.
- **Rate-limited feedback** — the `user-feedback` function allows 3 messages per user per hour.
- **No `eval` / `new Function` / `dangerouslySetInnerHTML`** in runtime code (only mentioned in comments documenting the resolver's deobfuscation).
- **TypeScript strict mode** on every file.
- **`.env`, `.env.*.local`, `dist/`, `.wrangler/`, `.expo/`** gitignored.
- **`workers/`, `docs/`, `tests/`, `scripts/`, `supabase/`, `.agents/`** excluded from EAS builds via `.easignore` — these never reach the mobile binary.
- **Supabase row-level security** policies enforce per-user data isolation, and Watch Together channels are private to room members (see `docs/DATABASE.md`).

## Coordinated Disclosure

We follow a 90-day disclosure window. After a fix ships (preview OTA + APK rebuild), the report becomes public. We'll credit reporters who want to be credited.

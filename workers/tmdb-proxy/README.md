# StreamBox TMDB Proxy

Cloudflare Worker proxy for TMDB API requests. It keeps the real TMDB credential out of the Expo JavaScript bundle and caches safe GET responses at the edge.

## Setup

```bash
cd workers/tmdb-proxy
npx wrangler secret put TMDB_ACCESS_TOKEN
npx wrangler deploy
```

Use a TMDB v4 access token for `TMDB_ACCESS_TOKEN`. If you only have a v3 API key, use `TMDB_API_KEY` instead:

```bash
npx wrangler secret put TMDB_API_KEY
```

Then set the app env to the deployed Worker URL:

```env
EXPO_PUBLIC_TMDB_PROXY_BASE_URL=https://streambox-tmdb-proxy.<your-subdomain>.workers.dev/3
```

For production builds, remove `EXPO_PUBLIC_TMDB_API_KEY` and `EXPO_PUBLIC_TMDB_ACCESS_TOKEN` from Expo/EAS env so they are not embedded in the app bundle.

## Notes

- The Worker accepts `GET`, `HEAD`, and `OPTIONS` only.
- `/3/movie/123` and `/movie/123` are both accepted.
- Query params are forwarded except `api_key`, which is always stripped from client requests.
- Search responses are cached for 5 minutes; other successful TMDB responses are cached for 6 hours.
- Requests are rate-limited per client IP. Defaults are `120` requests per `60` seconds and can be tuned with `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_SECONDS`.
- Worker logs are structured JSON with `tmdb_proxy_response`, `tmdb_proxy_rate_limited`, and `tmdb_proxy_error` events for production monitoring.

#!/usr/bin/env python3
"""
Fetch each classic film's original_title + alternative_titles from TMDB (via the
app's public proxy worker) so the YouTube matcher can bridge English MD titles to
the Azerbaijani/Russian titles used in the source playlist.

Writes a reproducible cache: outputs/az_tmdb_titles.json  { "<tmdbId>": ["title", ...] }
Run once before generate-az-classics.py (or whenever the film list changes).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "outputs" / "az_tmdb_titles.json"
JSON_IN = ROOT / "src" / "data" / "azClassics.json"


def proxy_base() -> str:
    env = (ROOT / ".env").read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"^EXPO_PUBLIC_TMDB_PROXY_BASE_URL\s*=\s*(.+)$", env, re.M)
    if not m:
        sys.exit("EXPO_PUBLIC_TMDB_PROXY_BASE_URL missing from .env")
    return m.group(1).strip().rstrip("/")


def fetch_titles(base: str, tmdb_id: int) -> list[str]:
    url = f"{base}/movie/{tmdb_id}?append_to_response=alternative_titles&language=en-US"
    req = urllib.request.Request(url, headers={"user-agent": "streambox-az-gen"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.load(resp)
    titles = [data.get("original_title"), data.get("title")]
    for alt in data.get("alternative_titles", {}).get("titles", []):
        titles.append(alt.get("title"))
    seen, out = set(), []
    for t in titles:
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def main() -> None:
    base = proxy_base()
    films = json.loads(JSON_IN.read_text(encoding="utf-8"))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    ids = [f["tmdbId"] for f in films if f.get("tmdbId")]
    todo = [i for i in ids if str(i) not in cache]
    print(f"{len(ids)} films with tmdbId; {len(todo)} to fetch, {len(ids) - len(todo)} cached")
    for n, tmdb_id in enumerate(todo, 1):
        try:
            cache[str(tmdb_id)] = fetch_titles(base, tmdb_id)
        except Exception as exc:  # noqa: BLE001 — record and continue
            print(f"  [{n}/{len(todo)}] id={tmdb_id} FAILED: {exc}")
            cache[str(tmdb_id)] = []
        if n % 25 == 0:
            print(f"  ...{n}/{len(todo)}")
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(0.05)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {CACHE.relative_to(ROOT)} ({len(cache)} entries)")


if __name__ == "__main__":
    main()

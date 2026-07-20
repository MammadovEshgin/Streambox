#!/usr/bin/env python3
"""
Azerbaijani Classics catalog generator (build-time, run locally — NOT app runtime).

Inputs
  list/azerbaijani_classic_films.md   Rich Letterboxd/TMDB extract (cast+crew photos).
  outputs/az_playlist.tsv             `videoId<TAB>title` for every video in the
                                      source YouTube playlist, produced by:
        python -m yt_dlp --flat-playlist --print "%(id)s\\t%(title)s" \\
          "https://www.youtube.com/playlist?list=PLAtI5OWgNzB1wzuPM18PZ2eKSagWgFMAv" \\
          > outputs/az_playlist.tsv

Output
  src/data/azClassics.json            Bundled catalog imported by the app.
  outputs/az_unmatched_report.txt     Films with no confident YouTube match / no poster.

Images: every TMDB image URL is reduced to its bare "/<hash>.jpg" path so the app can
render it through the existing getTmdbImageUrl(path, size) helper (image.tmdb.org, 200).
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MD_PATH = ROOT / "list" / "azerbaijani_classic_films.md"
PLAYLIST_TSV = ROOT / "outputs" / "az_playlist.tsv"
TMDB_TITLES = ROOT / "outputs" / "az_tmdb_titles.json"
OUT_JSON = ROOT / "src" / "data" / "azClassics.json"
OUT_REPORT = ROOT / "outputs" / "az_unmatched_report.txt"

# Confidence threshold for accepting a fuzzy title match.
MATCH_THRESHOLD = 0.62

# TMDB ids that fuzzy-matched to the WRONG movie entirely and must never ship.
# 329 = "Jurassic Park" (1993) — a source row mis-resolved to it.
EXCLUDED_TMDB_IDS = {329}

# Azerbaijani-latin -> ascii, mirroring how TMDB tends to slugify (ə is dropped).
AZ_MAP = {
    "ı": "i", "İ": "i", "i̇": "i",
    "ö": "o", "Ö": "o",
    "ü": "u", "Ü": "u",
    "ç": "c", "Ç": "c",
    "ş": "s", "Ş": "s",
    "ğ": "g", "Ğ": "g",
    "é": "e", "â": "a", "î": "i", "û": "u",
}

# Cyrillic -> latin, so Russian playlist/alt titles normalize the same on both sides.
RU_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
}


def _norm_with(text: str, schwa: str) -> str:
    out = []
    for ch in text:
        low = ch.lower()
        if ch in ("ə", "Ə"):
            out.append(schwa)
        elif ch in AZ_MAP:
            out.append(AZ_MAP[ch])
        elif low in RU_MAP:
            out.append(RU_MAP[low])
        else:
            out.append(ch)
    s = unicodedata.normalize("NFKD", "".join(out))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def norm(text: str) -> str:
    """Primary normalization (drop ə), az->ascii, strip accents, alnum only, lower."""
    return _norm_with(text or "", "")


def norm_variants(text: str) -> list[str]:
    """Both ə-handlings — TMDB is inconsistent (bizim-c-bis vs dede-qorqud)."""
    if not text:
        return []
    return list({_norm_with(text, ""), _norm_with(text, "e")} - {""})


def tmdb_path(url: str | None) -> str | None:
    """Reduce any TMDB image URL to its bare `/<file>` path."""
    if not url:
        return None
    m = re.search(r"/t/p/[^/]+(/[^)\s]+)", url)
    return m.group(1) if m else None


def parse_playlist() -> list[dict]:
    entries = []
    if not PLAYLIST_TSV.exists():
        print(f"WARNING: {PLAYLIST_TSV} missing — video IDs will all be null.", file=sys.stderr)
        return entries
    for line in PLAYLIST_TSV.read_text(encoding="utf-8").splitlines():
        # yt-dlp on Windows emits a literal backslash-t, not a real tab.
        sep = "\t" if "\t" in line else ("\\t" if "\\t" in line else None)
        if sep is None:
            continue
        vid, title = line.split(sep, 1)
        vid = vid.strip()
        if len(vid) < 8:
            continue
        year_m = re.search(r"\((\d{4})\)", title)
        year = int(year_m.group(1)) if year_m else None
        # Strip trailing "| English name", the "(YYYY)" and part markers.
        clean = title.split("|", 1)[0]
        clean = re.sub(r"\((\d{4})\)", "", clean)
        clean = re.sub(r"\b(hiss[əe]|part|seriy[ae]|b[öo]l[üu]m)\b.*$", "", clean, flags=re.I)
        entries.append({"videoId": vid, "raw": title.strip(), "year": year, "keys": norm_variants(clean)})
    return entries


BLOCK_RE = re.compile(r"^## (\d+)\.\s+(.*?)\s*\(([^)]*)\)\s*$", re.M)


def parse_md() -> list[dict]:
    text = MD_PATH.read_text(encoding="utf-8")
    starts = [(m.start(), m) for m in BLOCK_RE.finditer(text)]
    films = []
    for i, (pos, m) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        block = text[pos:end]
        no = int(m.group(1))
        title = m.group(2).strip()
        year = int(m.group(3)) if re.fullmatch(r"\d{4}", m.group(3) or "") else None

        poster = None
        pm = re.search(r"!\[[^\]]*Poster\]\((https?://[^)]+)\)", block)
        if pm:
            poster = tmdb_path(pm.group(1))

        def field(name: str) -> str | None:
            fm = re.search(rf"\|\s*\*\*{name}\*\*\s*\|\s*(.+?)\s*\|", block)
            return fm.group(1).strip() if fm else None

        release = field("Release Date")
        genres_raw = field("Genres")
        genres = [g.strip() for g in genres_raw.split(",") if g.strip()] if genres_raw else []
        runtime_raw = field("Runtime")
        runtime_min = None
        if runtime_raw:
            h = re.search(r"(\d+)h", runtime_raw)
            mm = re.search(r"(\d+)m", runtime_raw)
            runtime_min = (int(h.group(1)) * 60 if h else 0) + (int(mm.group(1)) if mm else 0) or None

        tmdb_id = None
        slug = ""
        tm = re.search(r"themoviedb\.org/movie/(\d+)-([^)\]\s]+)", block)
        if tm:
            tmdb_id = int(tm.group(1))
            slug = tm.group(2)

        synopsis = None
        sm = re.search(r"### Synopsis\s*\n+(.+?)(?:\n###|\n---|\Z)", block, re.S)
        if sm:
            synopsis = sm.group(1).strip().replace("\n", " ") or None

        cast = []
        cast_sec = re.search(r"### Cast\s*\n(.*?)(?:\n###|\n---|\Z)", block, re.S)
        if cast_sec:
            for row in re.finditer(
                r"\|\s*(?:!\[[^\]]*\]\((https?://[^)]+)\))?\s*\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|",
                cast_sec.group(1),
            ):
                cast.append({
                    "name": row.group(2).strip(),
                    "character": (row.group(3).strip() or None),
                    "photoPath": tmdb_path(row.group(1)),
                })

        crew = []
        crew_sec = re.search(r"### Crew\s*\n(.*?)(?:\n###|\n---|\Z)", block, re.S)
        if crew_sec:
            for row in re.finditer(
                r"\|\s*(?:!\[[^\]]*\]\((https?://[^)]+)\))?\s*\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|",
                crew_sec.group(1),
            ):
                crew.append({
                    "name": row.group(2).strip(),
                    "role": (row.group(3).strip() or None),
                    "department": (row.group(4).strip() or None),
                    "photoPath": tmdb_path(row.group(1)),
                })

        films.append({
            "no": no,
            "id": f"az-{no:03d}",
            "title": title,
            "year": year,
            "releaseDate": release,
            "genres": genres,
            "runtimeMinutes": runtime_min,
            "synopsis": synopsis,
            "posterPath": poster,
            "tmdbId": tmdb_id,
            "youtubeId": None,
            "cast": cast,
            "crew": crew,
            "_slug": slug,
            "_altTitles": [],
        })

    # Enrich match keys with TMDB original/alternative titles (Az + Ru bridge English).
    tmdb_titles = json.loads(TMDB_TITLES.read_text(encoding="utf-8")) if TMDB_TITLES.exists() else {}
    for film in films:
        film["_altTitles"] = tmdb_titles.get(str(film["tmdbId"]), []) if film["tmdbId"] else []
        key_sources = [film["_slug"], film["title"], *film["_altTitles"]]
        keys: set[str] = set()
        for src in key_sources:
            keys.update(norm_variants(src))
        film["_keys"] = [k for k in keys if len(k) >= 3]
    return films


def match_videos(films: list[dict], playlist: list[dict]) -> tuple[int, list[dict]]:
    # Global score-ranked assignment (not greedy in file order) so an exact title
    # match wins its video over a weaker same-year collision from another film.
    RAW_FLOOR = 0.5
    candidates: list[tuple[float, float, int, str]] = []
    for fi, film in enumerate(films):
        keys = film["_keys"]
        if not keys:
            continue
        for entry in playlist:
            if not entry["keys"]:
                continue
            ratio = max(
                (SequenceMatcher(None, k, e).ratio() for k in keys for e in entry["keys"]),
                default=0.0,
            )
            if ratio < RAW_FLOOR:
                continue
            year_ok = film["year"] is not None and entry["year"] == film["year"]
            year_near = (
                film["year"] is not None and entry["year"] is not None
                and abs(entry["year"] - film["year"]) <= 1
            )
            # Year only nudges ranking; acceptance still needs a real title ratio.
            score = ratio + (0.1 if year_ok else 0.03 if year_near else 0.0)
            candidates.append((score, ratio, fi, entry["videoId"]))

    candidates.sort(reverse=True)
    used: set[str] = set()
    taken_films: set[int] = set()
    matched = 0
    unmatched: list[dict] = []
    for score, ratio, fi, vid in candidates:
        if fi in taken_films or vid in used or score < MATCH_THRESHOLD:
            continue
        films[fi]["youtubeId"] = vid
        taken_films.add(fi)
        used.add(vid)
        matched += 1

    # Duplicate inheritance: a repeat listing of an already-matched film (same TMDB
    # id, or same normalized title+year) is the SAME movie -> share its video.
    by_tmdb = {f["tmdbId"]: f["youtubeId"] for f in films if f["youtubeId"] and f["tmdbId"]}
    by_title = {(norm(f["title"]), f["year"]): f["youtubeId"] for f in films if f["youtubeId"]}
    inherited = 0
    for film in films:
        if film["youtubeId"]:
            continue
        vid = (by_tmdb.get(film["tmdbId"]) if film["tmdbId"] else None) \
            or by_title.get((norm(film["title"]), film["year"]))
        if vid:
            film["youtubeId"] = vid
            inherited += 1

    for film in films:
        if not film["youtubeId"]:
            unmatched.append({
                "no": film["no"], "title": film["title"], "year": film["year"],
            })
    return matched + inherited, unmatched, inherited


def dedupe(films: list[dict]) -> tuple[list[dict], int]:
    """Collapse repeat listings of the same movie (source list repeats ~15 films).
    Key: tmdbId when present, else normalized title+year. Keep the richest entry,
    backfilling youtubeId / poster from its twin."""
    def richness(f: dict) -> tuple:
        return (
            1 if f["tmdbId"] else 0,
            1 if f["youtubeId"] else 0,
            1 if f["posterPath"] else 0,
            len(f["cast"]) + len(f["crew"]),
        )

    def pass_merge(items: list[dict], keyfn) -> list[dict]:
        groups: dict = {}
        order: list = []
        for f in items:
            key = keyfn(f)
            if key is None:  # un-mergeable this pass — keep as-is
                uniq = ("_u", id(f))
                groups[uniq] = f
                order.append(uniq)
                continue
            if key not in groups:
                groups[key] = f
                order.append(key)
            else:
                keep = groups[key]
                keep["youtubeId"] = keep["youtubeId"] or f["youtubeId"]
                keep["posterPath"] = keep["posterPath"] or f["posterPath"]
                if richness(f) > richness(keep):
                    f["youtubeId"] = f["youtubeId"] or keep["youtubeId"]
                    f["posterPath"] = f["posterPath"] or keep["posterPath"]
                    groups[key] = f
        return [groups[k] for k in order]

    # Pass 1: merge by TMDB id (same movie, different listing).
    # Pass 2: merge remaining by normalized title + year (catches twins where one
    # listing lacks a TMDB id, e.g. two "Only You (1986)" rows).
    merged = pass_merge(films, lambda f: ("t", f["tmdbId"]) if f["tmdbId"] else None)
    merged = pass_merge(merged, lambda f: ("n", norm(f["title"]), f["year"]))
    return merged, len(films) - len(merged)


def main() -> None:
    films = parse_md()
    playlist = parse_playlist()
    matched, unmatched, inherited = match_videos(films, playlist)
    films, removed_dupes = dedupe(films)

    films = [f for f in films if f["tmdbId"] not in EXCLUDED_TMDB_IDS]

    # Posterless entries render as blank "No image" cards in the grid — report
    # them for manual fixing but keep them OUT of the shipped bundle.
    no_poster = [f for f in films if not f["posterPath"]]
    films = [f for f in films if f["posterPath"]]

    # Strip private match-only keys before writing the bundle.
    for f in films:
        f.pop("_keys", None)
        f.pop("_slug", None)
        f.pop("_altTitles", None)
        f.pop("no", None)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(films, ensure_ascii=False, indent=2), encoding="utf-8")

    matched_final = sum(1 for f in films if f["youtubeId"])
    lines = [
        f"Unique films: {len(films)}  (deduped {removed_dupes} repeat listings)",
        f"Playlist videos: {len(playlist)}",
        f"YouTube matched (unique films): {matched_final}  |  unmatched: {len(films) - matched_final}",
        f"Missing poster: {len(no_poster)}",
        "",
        "== UNMATCHED (need manual youtubeId) ==",
    ]
    for f in films:
        if not f["youtubeId"]:
            lines.append(f"  {f['id']} {f['title']} ({f['year']})  tmdb={f['tmdbId']}")
    lines.append("")
    lines.append("== MISSING POSTER ==")
    for f in no_poster:
        lines.append(f"  {f['id']} {f['title']} ({f['year']})")
    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUT_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}  ({len(films)} unique films)")
    print(f"Matched {matched_final}/{len(films)} youtube IDs; {len(films) - matched_final} unmatched; {len(no_poster)} missing poster; deduped {removed_dupes}")
    print(f"Report: {OUT_REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Seed a local DiscVault Core instance with a demo library from manifest.json.

No external metadata lookups are made: every record comes from the manifest and
every image from a local file, uploaded into the app's own artwork store
(<data dir>/media/..., served from /api/next/media/assets/<id>).

Usage (normally via `run.sh seed`, which exports the environment):

    seed_demo.py [--manifest manifest.json] [--base http://127.0.0.1:5055]
                 [--force-artwork]

Environment (same values the API runs with):
    DATABASE_URL, JWT_SECRET, DISCVAULT_LEGACY_DATA_DIR  - for the in-process steps
    DV_OWNER_USERNAME / DV_OWNER_PASSWORD / DV_OWNER_DISPLAY_NAME
    DV_REPO   a checkout of helmerzNL/DiscVault (run.sh requires it)

Manifest schema
---------------
{
  "owner":     {"username": "alex", "display_name": "Alex Morgan"},      (optional)
  "users":     [{"username", "display_name", "role"}],                   (optional; role = media_viewer|media_fan|media_editor|admin)
  "locations": [{"name": "Living room > Shelf A", "description": "", "backdrop": "path"}],
               (optional; " > " nests; backdrop = local 16:9 image for the location page header.
               NOTE: use the very same file as one film's "backdrop" - 26.11.0 does not serve an
               image that only a location references, see the report)
  "tags":      [{"name", "color"}],                                      (optional)
  "rating_country": "NL",                                                (optional; country of "content_rating")
  "enable_plugins": ["import_clz_movies", ...],                          (optional; default: the four file-based
               import-source plugins, so Add > Import sources has something to show. None needs the network.)
  "catalog":   [{"title", "year", "format", "barcode", "poster", "edition", "studio", "runtime"}],
               (optional) discs that are NOT owned but that the Add / Scan screen should recognise
               offline. They are written into the local MovieVault catalogue mirror; every
               "wishlist" film is mirrored too. Scanning one of these barcodes then shows a real
               result card with its poster, without any network access.
  "films": [
    {
      "title": str,                      required
      "year": int,
      "format": "4K UHD" | "Blu-ray" | "DVD",
      "edition": str,                    optional, e.g. "Limited Edition Steelbook"
      "steelbook": bool,                 optional -> carrier type "steelbook"
      "outer_packaging": ["slipcover"],  optional (slipcover, o_card, fullslip, lenticular_slip, slipcase ...)
      "finishes": ["embossed"],          optional
      "barcode": str,                    recommended (it is the identity used for idempotent re-runs)
      "poster": "path.png|jpg|webp",     local file, relative to the manifest; 2:3, 1000x1500 recommended
      "backdrop": "path",                optional local file; 16:9, 1920x1080 recommended
      "overview": str, "runtime": int (minutes),
      "genres": ["science_fiction", ...]  genre keys or English names ("Science Fiction", "Sci-Fi")
      "director": str,
      "cast": ["Name", {"name": "Name", "character": "Role"}],
      "studio": str, "community_rating": 7.4,
      "content_rating": "12",            age rating shown on the detail page (for rating_country)
      "tech": {"resolution": "2160p", "hdr": ["Dolby Vision"], "audio": "Dolby Atmos", "region": "ABC"},
      "location": "Living room > Shelf A",
      "purchase_date": "YYYY-MM-DD", "purchase_price": 19.99, "value": 25.0,
      "rating": 8.5,                     the owner's personal score (0.5 .. 10, steps of 0.5)
      "tags": ["Favourites"],
      "watchlist": true,
      "watched": "YYYY-MM-DD" | ["YYYY-MM-DD", ...],
      "box_set": {"name": str, "year": int, "barcode": str, "poster": "path",
                  "description": str, "location": str},
                 films carrying the same box_set.name become members, in manifest order;
                 "members": ["Other title", ...] may add further manifest films by title
      "wishlist": true,                  NOT owned: becomes a wishlist entry instead of a library film
      "note": str,                       wishlist note
      "price_alert": {"shop", "url", "currency", "current", "target", "history": [..]}   wishlist only
    }
  ]
}

How each thing is written
-------------------------
  HTTP API (the app's own routes, authenticated as the owner):
    owner bootstrap/login, preferences + locale (dark, bluray, collectors mode on - box-set
    pages need it), enabling the import-source plugins, extra users, locations, tags,
    films (POST /api/next/sync/mutations, entityType movie - the sync upsert
    writer the mobile apps use), poster/backdrop uploads, box sets + membership,
    watchlist, watch history, personal ratings, wishlist entries + posters.
  In-process call of the app's own writer (next_app.apply_metadata_proposal, the
    function every metadata plugin result goes through): genres, director,
    cast/crew credits, studio, community rating, audio/subtitle tracks. There is
    no HTTP route for these that does not start from a provider lookup.
  In-process, the app's own catalogue-mirror writer (next_movievault_v2.validate_record +
    _apply_record, and next_movievault_v2_posters._store_poster_bytes/_activate_media_asset):
    the "catalog" + wishlist discs, in distribution-4 record format. Plus two plain SQL
    statements around it (the sync-state row that marks the mirror current, and the
    poster-cache row) - the same rows a real catalogue sync leaves behind.
  Raw SQL (no offline route exists - the shop route fetches the price URL):
    wishlist price alerts (wishlist_items alert columns, wishlist_item_shops,
    wishlist_item_shop_prices), back-dating created_at on the seeded films, and renaming the
    built-in admin role from its stored Dutch name "Beheerder" to "Administrator".
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import mimetypes
import os
import re
import sys
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

warnings.filterwarnings("ignore")

GENRE_KEYS = {
    "action", "adventure", "animation", "comedy", "crime", "documentary", "drama", "family",
    "fantasy", "history", "horror", "music", "mystery", "romance", "science_fiction",
    "tv_movie", "thriller", "war", "western",
}
GENRE_ALIASES = {"sci-fi": "science_fiction", "scifi": "science_fiction", "sf": "science_fiction",
                 "science fiction": "science_fiction", "tv movie": "tv_movie", "musical": "music",
                 "historical": "history", "kids": "family", "animated": "animation"}


def log(msg: str) -> None:
    print(msg, flush=True)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def genre_key(value: str) -> str | None:
    key = str(value or "").strip().lower()
    key = GENRE_ALIASES.get(key, key).replace(" ", "_").replace("-", "_")
    return key if key in GENRE_KEYS else None


def find_id(obj, prefer=("location", "container", "tag", "item", "wishlistItem", "entry", "detail", "entity")) -> str:
    """Pull the created entity's id out of a create response, whatever it is wrapped in."""
    if isinstance(obj, dict):
        for key in prefer:
            if isinstance(obj.get(key), dict):
                found = find_id(obj[key], prefer)
                if found:
                    return found
        if obj.get("id"):
            return str(obj["id"])
    return ""


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.s.trust_env = False  # never route the local API through a proxy
        self.s.headers["Origin"] = self.base

    def call(self, method: str, path: str, *, ok=(200, 201), **kw):
        r = self.s.request(method, self.base + path, timeout=120, **kw)
        if r.status_code not in ok:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:400]}")
        try:
            return r.json()
        except ValueError:
            return {}

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.call("POST", path, json=body if body is not None else {}, **kw)

    def patch(self, path, body, **kw):
        return self.call("PATCH", path, json=body, **kw)

    def put(self, path, body, **kw):
        return self.call("PUT", path, json=body, **kw)

    def upload(self, path: str, file_path: Path, kind: str):
        ctype = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        with file_path.open("rb") as fh:
            return self.call("POST", path, data={"kind": kind, "primary": "true"},
                             files={"file": (file_path.name, fh, ctype)})


def ensure_owner(api: Api, username: str, password: str, display_name: str) -> None:
    status = api.get("/api/next/auth/status")
    if status.get("setup_required") and status.get("legacy_bootstrap_available"):
        if not status.get("legacy_bootstrap_mfa_optional"):
            raise RuntimeError(
                "First-owner password onboarding wants TOTP here. Use http://127.0.0.1:<port> "
                "(a local IP) and leave RP_ID unset so MFA is optional for the bootstrap."
            )
        start = api.post("/api/next/auth/legacy/bootstrap/start", {
            "username": username, "display_name": display_name, "password": password, "mfa_enabled": False,
        })
        done = api.post("/api/next/auth/legacy/recovery-codes/ack",
                        {"flow_token": start["flow_token"], "acknowledged": True})
        log(f"owner created: {username} ({display_name}) -> {done.get('stage')}")
    else:
        done = api.post("/api/next/auth/legacy/login", {"username": username, "password": password})
        if done.get("stage") != "complete":
            raise RuntimeError(f"login did not complete: {done}")
        log(f"owner login ok: {username}")
    me = api.get("/api/next/auth/me")
    if not me.get("authenticated"):
        raise RuntimeError("not authenticated after login")
    api.patch("/api/next/preferences", {"theme": "dark", "accent": "bluray", "collectors_mode": True})
    api.post("/api/next/preferences/locale", {"locale": "en"})


def ensure_users(api: Api, users: list[dict]) -> None:
    existing = {u.get("username") for u in api.get("/api/next/auth/users").get("users", [])}
    for user in users:
        if user["username"] in existing:
            continue
        api.post("/api/next/auth/users", {
            "username": user["username"],
            "display_name": user.get("display_name") or user["username"],
            "temporary_password": user.get("password") or f"Demo-{user['username']}-Shelf-2026!",
            "role": user.get("role") or "media_viewer",
            "mfa_required": False,
        })
        log(f"user created: {user['username']} ({user.get('role')})")


def ensure_locations(api: Api, wanted: list[str], described: dict[str, str],
                     backdrops: dict[str, Path] | None = None) -> dict[str, str]:
    """Create "A > B" paths; return {path: location_id}."""
    listing = api.get("/api/next/locations")
    rows = listing.get("locations") or listing.get("items") or []
    by_key: dict[tuple[str | None, str], str] = {}
    for row in rows:
        by_key[(row.get("parent_id") or row.get("parentId"), row.get("name"))] = row["id"]
    result: dict[str, str] = {}
    paths: list[str] = []
    for path in wanted:
        parts = [p.strip() for p in path.split(">") if p.strip()]
        for i in range(1, len(parts) + 1):
            sub = " > ".join(parts[:i])
            if sub not in paths:
                paths.append(sub)
    for order, path in enumerate(paths):
        parts = path.split(" > ")
        parent_id = result.get(" > ".join(parts[:-1])) if len(parts) > 1 else None
        key = (parent_id, parts[-1])
        if key not in by_key:
            body = {"name": parts[-1], "description": described.get(path, ""), "sortOrder": order}
            if parent_id:
                body["parentId"] = parent_id
            made = api.post("/api/next/locations", body)
            by_key[key] = find_id(made, prefer=("detail", "location"))
            if backdrops and backdrops.get(path):
                api.upload(f"/api/next/locations/{by_key[key]}/backdrop/upload", backdrops[path], "backdrop")
            log(f"location created: {path}")
        result[path] = by_key[key]
    return result


def film_payload(film: dict, locations: dict[str, str], rating_country: str = "NL") -> dict:
    payload = {
        "title": film["title"],
        "year": str(film["year"]) if film.get("year") else None,
        "format": film.get("format"),
        "barcode": film.get("barcode"),
        "edition": film.get("edition"),
        "overview": film.get("overview"),
        "runtimeMinutes": film.get("runtime"),
        "purchaseDate": film.get("purchase_date"),
        "purchasePrice": film.get("purchase_price"),
        "estimatedValue": film.get("value"),
        "estimatedValueCurrency": "EUR" if film.get("value") else None,
        "notes": film.get("notes"),
        "mediaType": "MOVIE",
    }
    tech = film.get("tech") or {}
    if tech.get("resolution"):
        payload["videoResolution"] = tech["resolution"]
    if tech.get("hdr"):
        payload["hdr"] = tech["hdr"]
    if tech.get("region"):
        payload["regions"] = [tech["region"]] if isinstance(tech["region"], str) else tech["region"]
    if tech.get("aspect"):
        payload["screenRatio"] = tech["aspect"]
    payload["carrierType"] = "steelbook" if film.get("steelbook") else (film.get("carrier") or "keep_case")
    if film.get("outer_packaging"):
        payload["outerPackaging"] = film["outer_packaging"]
    if film.get("finishes"):
        payload["finishes"] = film["finishes"]
    if film.get("location") and locations.get(film["location"]):
        payload["locationId"] = locations[film["location"]]
    if film.get("content_rating"):
        payload["contentRating"] = str(film["content_rating"])
        payload["ratingCountry"] = rating_country
    return {k: v for k, v in payload.items() if v is not None}


def proposal_for(film: dict) -> dict:
    credits = []
    if film.get("director"):
        for i, name in enumerate([n.strip() for n in str(film["director"]).split(",") if n.strip()]):
            credits.append({"name": name, "role": "director", "job": "Director", "sortOrder": i})
    for i, member in enumerate(film.get("cast") or []):
        if isinstance(member, str):
            member = {"name": member}
        if member.get("name"):
            credits.append({"name": member["name"], "role": "actor",
                            "character": member.get("character"), "sortOrder": i})
    metadata = {}
    if film.get("director"):
        metadata["director"] = film["director"]
    if film.get("studio"):
        metadata["studios"] = film["studio"]
    if film.get("tagline"):
        metadata["tagline"] = film["tagline"]
    movie_updates = {}
    if film.get("community_rating") is not None:
        movie_updates["rating"] = str(film["community_rating"])
        movie_updates["rating_votes"] = int(film.get("community_votes") or 1200 + len(film["title"]) * 137)
    proposal: dict = {"credits": credits, "metadataUpdates": metadata, "movieUpdates": movie_updates}
    genres = [g for g in (genre_key(x) for x in film.get("genres") or []) if g]
    if genres:
        proposal["genreKeys"] = genres
    tech = film.get("tech") or {}
    technical = {}
    if tech.get("audio"):
        audio = tech["audio"] if isinstance(tech["audio"], list) else [tech["audio"]]
        technical["audio_tracks"] = [a if ":" in a else f"English: {a}" for a in audio]
    subs = tech.get("subtitles") or ["en", "nl", "de", "fr"]
    technical["subtitles"] = [{"languageCode": s, "subtitleType": "full"} for s in subs]
    if technical:
        proposal["technicalUpdates"] = technical
    return proposal


MIRROR_NAMESPACE = uuid.UUID("5f0c2d6e-0000-4000-8000-00000000d15c")


def mirror_catalog(next_app, entries: list[dict], local) -> int:
    """Write not-owned discs into the local MovieVault catalogue mirror.

    The Add / Scan screen resolves a barcode against this mirror first, so a
    mirrored disc gives a real result card offline. Records are built in the
    distribution-4 wire format and go through the app's own validator and
    writer; ids are derived from the barcode, so re-runs are idempotent.
    """
    import next_movievault_v2 as mv
    import next_movievault_v2_posters as mvp
    from PIL import Image

    def uid(kind: str, key: str) -> str:
        return str(uuid.uuid5(MIRROR_NAMESPACE, f"{kind}:{key}"))

    contract = mv.MOVIEVAULT_V4_CONTRACT
    origin = "https://catalog.invalid"  # never contacted; .invalid cannot resolve
    done = 0
    with next_app.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT active_generation FROM movievault_v2_sync_state WHERE plugin_id=%s",
                        (mv.MOVIEVAULT_V2_PLUGIN_ID,))
            row = cur.fetchone() or {}
            generation = str(row.get("active_generation") or uuid.uuid4())
            cur.execute(
                """
                INSERT INTO movievault_v2_sync_state
                    (plugin_id, origin, active_generation, contract_version, cursor, revision,
                     status, last_attempt_at, last_success_at)
                VALUES (%s, %s, %s, %s, 'demo', 1, 'current', now(), now())
                ON CONFLICT (plugin_id) DO UPDATE
                SET active_generation=EXCLUDED.active_generation, contract_version=EXCLUDED.contract_version,
                    status='current', last_success_at=now(), last_error_code=NULL
                """,
                (mv.MOVIEVAULT_V2_PLUGIN_ID, origin, generation, contract),
            )
            for index, entry in enumerate(entries):
                digits = "".join(c for c in str(entry.get("barcode") or "") if c.isdigit())
                if not digits:
                    continue
                poster = None
                path = local(entry.get("poster"))
                if path:
                    image = Image.open(path).convert("RGB")
                    image.thumbnail((2000, 3000))
                    buffer = io.BytesIO()
                    image.save(buffer, "JPEG", quality=88)
                    content = buffer.getvalue()
                    checksum = hashlib.sha256(content).hexdigest()
                    asset_id = uid("asset", digits)
                    key = mvp._store_poster_bytes(content, checksum, "display", "jpg")
                    media_id = mvp._activate_media_asset(
                        cur, variant="display", storage_key=key, content_type="image/jpeg",
                        width=image.width, height=image.height, size_bytes=len(content),
                        checksum=checksum, asset_id=asset_id)
                    # Both variants are marked ready up front, so the writer below finds
                    # nothing to fetch and queues no poster-download job for the worker.
                    for variant in ("display", "thumbnail"):
                        cur.execute(
                            """
                            INSERT INTO movievault_v2_poster_cache (asset_id, variant, checksum, status, media_asset_id)
                            VALUES (%s, %s, %s, 'ready', %s)
                            ON CONFLICT (asset_id, variant, checksum)
                            DO UPDATE SET status='ready', media_asset_id=EXCLUDED.media_asset_id
                            """,
                            (asset_id, variant, checksum, media_id),
                        )
                    poster = {
                        "assetId": asset_id, "assetType": "front_cover", "attestation": "original",
                        "license": "cc-by-4.0",
                        "display": {"checksum": checksum, "path": f"/v2/assets/{asset_id}/display"},
                        "thumbnail": {"checksum": checksum, "path": f"/v2/assets/{asset_id}/thumbnail"},
                    }
                record = {
                    "contractVersion": contract, "recordType": "release", "operation": "upsert",
                    "revision": index + 1, "releaseId": uid("release", digits),
                    "filmId": uid("film", entry["title"]), "canonicalTitle": entry["title"],
                    "providerIds": {}, "releaseTitle": entry["title"],
                    "eanHashes": [hashlib.sha256(digits.encode("ascii")).hexdigest()],
                    "assets": [], "poster": poster, "releaseYear": entry.get("year"),
                    "format": entry.get("format"), "edition": entry.get("edition"), "region": "B",
                    "discCount": 1, "studio": entry.get("studio"), "runtimeMinutes": entry.get("runtime"),
                }
                record = {k: v for k, v in record.items() if v is not None or k == "poster"}
                mv._apply_record(cur, generation, mv.validate_record(record, contract_version=contract), origin)
                done += 1
        conn.commit()
    return done


def main() -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", default=str(here / "manifest.json"))
    ap.add_argument("--base", default=os.environ.get("DV_BASE_URL", "http://127.0.0.1:5055"))
    ap.add_argument("--force-artwork", action="store_true", help="re-upload artwork for films that already exist")
    args = ap.parse_args()

    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text())
    root = manifest_path.parent

    def local(path_text: str | None) -> Path | None:
        if not path_text:
            return None
        p = Path(path_text)
        p = p if p.is_absolute() else root / p
        if not p.is_file():
            raise FileNotFoundError(f"artwork file not found: {p}")
        return p

    owner = manifest.get("owner") or {}
    username = os.environ.get("DV_OWNER_USERNAME") or owner.get("username") or "alex"
    display_name = os.environ.get("DV_OWNER_DISPLAY_NAME") or owner.get("display_name") or "Alex Morgan"
    password = os.environ["DV_OWNER_PASSWORD"]  # exported by run.sh

    api = Api(args.base)
    ensure_owner(api, username, password, display_name)
    ensure_users(api, manifest.get("users") or [])

    default_plugins = ["import_clz_movies", "import_bluray_com", "import_letterboxd", "import_mymovies_dk"]
    for plugin_id in manifest.get("enable_plugins", default_plugins):
        api.patch(f"/api/next/plugins/{plugin_id}", {"enabled": True})

    films = manifest.get("films") or []
    owned = [f for f in films if not f.get("wishlist")]
    wishes = [f for f in films if f.get("wishlist")]

    # ---- locations -------------------------------------------------------
    described = {l["name"]: l.get("description") or "" for l in manifest.get("locations") or []}
    wanted = list(described)
    for film in owned:
        for loc in (film.get("location"), (film.get("box_set") or {}).get("location")):
            if loc and loc not in wanted:
                wanted.append(loc)
    location_backdrops = {l["name"]: local(l.get("backdrop")) for l in manifest.get("locations") or []
                          if l.get("backdrop")}
    locations = ensure_locations(api, wanted, described, location_backdrops)

    # ---- tags ------------------------------------------------------------
    tag_ids: dict[str, str] = {}
    listing = api.get("/api/next/tags")
    for tag in listing.get("tags") or listing.get("items") or []:
        tag_ids[tag["name"]] = tag["id"]
    for tag in manifest.get("tags") or []:
        if tag["name"] not in tag_ids:
            made = api.post("/api/next/tags", {"name": tag["name"], "color": tag.get("color")})
            tag_ids[tag["name"]] = find_id(made)

    # ---- films: the sync upsert writer -------------------------------------
    movie_ids: dict[str, str] = {}
    created: dict[str, bool] = {}
    run_id = uuid.uuid4().hex[:12]
    for start in range(0, len(owned), 50):
        chunk = owned[start:start + 50]
        mutations = []
        for film in chunk:
            key = slugify(f"{film['title']}-{film.get('year', '')}-{film.get('format', '')}")
            mutations.append({
                # unique per run: a repeated mutation id replays the stored response
                # (created=true) instead of reporting that the film already exists
                "clientMutationId": f"seed-{key}-{run_id}",
                "clientEntityId": f"seed-{key}",
                "entityType": "movie",
                "operation": "upsert",
                "payload": film_payload(film, locations, str(manifest.get("rating_country") or "NL").upper()),
            })
        res = api.post("/api/next/sync/mutations", {"clientId": "dvcore-demo-seed", "mutations": mutations})
        for film, item in zip(chunk, res["results"]):
            if item.get("status") != "applied":
                raise RuntimeError(f"movie upsert failed for {film['title']}: {item}")
            movie_ids[film["title"]] = item["entityId"]
            created[film["title"]] = bool(item.get("created"))
    log(f"films upserted: {len(movie_ids)} ({sum(created.values())} new)")

    # ---- genres, credits, studio, ratings: the app's own proposal writer ---
    repo = os.environ["DV_REPO"]
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(repo) / "app" / "backend"))
    import next_app  # noqa: E402  (needs DATABASE_URL + JWT_SECRET in the environment)

    with next_app.connect() as conn:
        for film in owned:
            with conn.transaction():
                next_app.apply_metadata_proposal(conn, movie_ids[film["title"]], proposal_for(film), actor=None)
        conn.commit()
    log("genres / credits / studio / ratings applied")

    # ---- artwork ---------------------------------------------------------
    uploaded = 0
    for film in owned:
        mid = movie_ids[film["title"]]
        if not (created[film["title"]] or args.force_artwork):
            continue
        for kind in ("poster", "backdrop"):
            path = local(film.get(kind))
            if path:
                api.upload(f"/api/next/movies/{mid}/media/upload", path, kind)
                uploaded += 1
    log(f"artwork uploaded: {uploaded} files")

    # ---- personal lists, ratings, tags --------------------------------------
    for film in owned:
        mid = movie_ids[film["title"]]
        if not created[film["title"]]:
            continue
        if film.get("watchlist"):
            api.post(f"/api/next/movies/{mid}/watchlist")
        watched = film.get("watched")
        for when in ([watched] if isinstance(watched, str) else (watched or [])):
            stamp = when if "T" in when else f"{when}T20:30:00Z"
            api.post(f"/api/next/movies/{mid}/watched", {"watchedAt": stamp})
        if film.get("rating") is not None:
            api.put(f"/api/next/movies/{mid}/rating", {"score": film["rating"]})
        for name in film.get("tags") or []:
            body = {"tagId": tag_ids[name]} if name in tag_ids else {"name": name}
            api.post(f"/api/next/movies/{mid}/tags", body)

    # ---- box sets ----------------------------------------------------------
    by_title = {f["title"]: f for f in owned}
    boxes: dict[str, dict] = {}
    for film in owned:
        box = film.get("box_set")
        if not box:
            continue
        if isinstance(box, str):
            box = {"name": box}
        entry = boxes.setdefault(box["name"], {"meta": {}, "members": []})
        entry["meta"].update({k: v for k, v in box.items() if k != "members"})
        for title in [film["title"], *(box.get("members") or [])]:
            if title in by_title and title not in entry["members"]:
                entry["members"].append(title)
    listing = api.get("/api/next/containers")
    existing_boxes = {}
    for row in listing.get("containers") or listing.get("items") or []:
        row = row.get("container") or row
        existing_boxes[row.get("title")] = row["id"]
    box_ids: dict[str, str] = {}
    for name, entry in boxes.items():
        meta = entry["meta"]
        if name in existing_boxes:
            box_ids[name] = existing_boxes[name]
            continue
        body = {"containerType": "box_set", "title": name, "barcode": meta.get("barcode"),
                "year": str(meta["year"]) if meta.get("year") else None,
                "description": meta.get("description")}
        if meta.get("location") and locations.get(meta["location"]):
            body["locationId"] = locations[meta["location"]]
        made = api.post("/api/next/containers", {k: v for k, v in body.items() if v is not None})
        cid = find_id(made, prefer=("detail", "container"))
        box_ids[name] = cid
        poster = local(meta.get("poster"))
        if poster:
            api.upload(f"/api/next/containers/{cid}/media/upload", poster, "poster")
        for title in entry["members"]:
            api.post(f"/api/next/movies/{movie_ids[title]}/containers/{cid}")
        log(f"box set created: {name} ({len(entry['members'])} films)")

    # ---- wishlist ----------------------------------------------------------
    listing = api.get("/api/next/lists/wishlist")
    have = {w.get("title") for w in listing.get("items") or listing.get("wishlist") or []}
    wish_ids: dict[str, str] = {}
    for film in wishes:
        if film["title"] in have:
            continue
        made = api.post("/api/next/lists/wishlist", {
            "title": film["title"], "year": film.get("year"), "format": film.get("format"),
            "barcode": film.get("barcode"), "note": film.get("note"), "source": "manual",
        })
        item = {"id": find_id(made)}
        wish_ids[film["title"]] = item["id"]
        poster = local(film.get("poster"))
        if poster:
            api.upload(f"/api/next/lists/wishlist/{item['id']}/poster", poster, "poster")
    if wish_ids:
        log(f"wishlist entries created: {len(wish_ids)}")

    # ---- offline catalogue mirror (Add / Scan recognises these barcodes) ------
    mirrored = mirror_catalog(next_app, [*(manifest.get("catalog") or []), *wishes], local)
    if mirrored:
        log(f"catalogue mirror: {mirrored} not-owned discs recognisable by barcode offline")

    # ---- raw SQL: price alerts + back-dated timestamps ------------------------
    now = datetime.now(timezone.utc)
    with next_app.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE lower(username)=lower(%s)", (username,))
            user_id = cur.fetchone()["id"]
            for film in wishes:
                alert = film.get("price_alert")
                wid = wish_ids.get(film["title"])
                if not alert or not wid:
                    continue
                currency = alert.get("currency") or "EUR"
                history = alert.get("history") or [alert["current"]]
                cur.execute(
                    """
                    UPDATE wishlist_items
                    SET alert_enabled=true, target_price=%s, price_url=%s, last_seen_price=%s,
                        price_currency=%s, last_price_checked_at=%s
                    WHERE id=%s
                    """,
                    (alert.get("target"), alert["url"], alert["current"], currency, now - timedelta(hours=3), wid),
                )
                cur.execute(
                    """
                    INSERT INTO wishlist_item_shops
                        (user_id, wishlist_item_id, shop_name, price_url, price_currency,
                         last_seen_price, last_price_checked_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (wishlist_item_id, price_url) DO UPDATE
                        SET last_seen_price=EXCLUDED.last_seen_price
                    RETURNING id
                    """,
                    (user_id, wid, alert["shop"], alert["url"], currency, alert["current"], now - timedelta(hours=3)),
                )
                shop_id = cur.fetchone()["id"]
                for i, price in enumerate(history):
                    cur.execute(
                        """
                        INSERT INTO wishlist_item_shop_prices
                            (user_id, wishlist_item_id, wishlist_item_shop_id, observed_price,
                             price_currency, observed_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (user_id, wid, shop_id, price, currency,
                         now - timedelta(days=7 * (len(history) - 1 - i), hours=3)),
                    )
            # Migration 007 names the built-in admin role "Beheerder" (Dutch) and the UI shows
            # that stored name untranslated in every locale. Demo database only: give it the
            # English name so the Users / Roles screens read as English. DV_KEEP_ROLE_NAMES=1 skips.
            if os.environ.get("DV_KEEP_ROLE_NAMES") != "1":
                cur.execute("UPDATE roles SET name='Administrator' WHERE key='admin' AND name='Beheerder'")
            # Spread "added" dates so Recently added / statistics do not show one flat day.
            fresh = [t for t, was_new in created.items() if was_new]
            for i, title in enumerate(fresh):
                film = by_title[title]
                added = film.get("purchase_date")
                stamp = (datetime.fromisoformat(added).replace(tzinfo=timezone.utc, hour=18)
                         if added else now - timedelta(days=3 * (len(fresh) - i)))
                if stamp > now:
                    stamp = now - timedelta(days=1)
                cur.execute("UPDATE movies SET created_at=%s WHERE id=%s", (stamp, movie_ids[title]))
        conn.commit()

    stats = api.get("/api/next/stats")
    log("done. stats: " + json.dumps({k: v for k, v in stats.items()
                                      if isinstance(v, (int, float, str))})[:300])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

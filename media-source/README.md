# Media source

Where the pictures and loops on discvault.eu come from, and how to make them
again. Nothing in this folder is published: Astro only builds `src/` and
`public/`. The slots the site reads are in `src/assets/media/` (see the
"Media" section of the repository README).

The rules these tools follow are in `Flux76HQ/App-Guidance`,
`projects/discvault/website/chrome-and-blue-web.md` (media slots, the demo
library, loops) and ADR-0021.

## What is here

| Folder | Contents |
| --- | --- |
| `library/` | The demo shelf: `manifest.json` (54 owned films, four wishlist entries, three box sets, one Steelbook, locations, tags, users) with its covers and backdrops |
| `screenshots/` | Screenshots of the self-hosted edition showing that shelf (dark theme, Blu-ray accent, English) |
| `screenshots-light/` | The nine of those that the site uses, taken again in the light theme |
| `tools/` | Scripts that run the self-hosted edition locally, seed it from the manifest and take the screenshots and loop frames |
| `promo/` | The 21-second promo film as an HTML timeline, rendered frame by frame |
| `appstore/` | The App Store screenshot template (1320 × 2868, one colour field per panel) |
| `kit/` | The share image, the banner and the disc still, with the pages they are rendered from |

## The demo shelf

Every film, person, studio, shop, price and barcode in `library/manifest.json`
is invented, and the covers and backdrops are generated artwork. That is the
point: the site, its loops and its share images show no artwork DiscVault has
no right to. Barcodes start with 2, the GS1 prefix reserved for in-store use,
so none can belong to a real product. Keep it that way when adding films.

## Taking the screenshots again

The tools need a checkout of the self-hosted edition (`helmerzNL/DiscVault`),
PostgreSQL 16 or newer, Python 3.13 with `uv`, and a Playwright with Chromium.
They write only next to themselves (a virtualenv, a private PostgreSQL
cluster, the artwork store, logs, shots), all git-ignored; the DiscVault
checkout is only read. No real metadata service is contacted.

```sh
cd media-source/tools
export DV_REPO=/path/to/DiscVault
export DV_MANIFEST="$PWD/../library/manifest.json"
DV_FEATURED="Orbit of Ash" DV_DETAIL="The Clockmaker's Fox" \
  DV_BOXSET="The Meridian Trilogy" ./run.sh all   # reset, seed, shots
./run.sh stop
```

`run.sh` generates the session secret and the owner password once into
`.demo-env`; neither is in the repository. Screenshots land in `tools/shots/`
as PNG (desktop 3200 × 2000, phone 1170 × 2532). The copies in `screenshots/`
are those files as WebP.

**The light theme.** The site shows the interface in the visitor's scheme, so
every screenshot it uses exists twice. `DV_THEME=light` makes `shots.mjs` and
`film.mjs` take the light interface; without it they take the dark one. The
variable sets all three things that decide the theme: the browser's colour
scheme, the theme the app keeps in the browser, and the owner's stored
preference, which wins over the other two. Name the shots to take, and send
them to their own folder:

```sh
DV_THEME=light DV_SHOTS_DIR="$PWD/shots-light" \
  DV_FEATURED="Orbit of Ash" DV_DETAIL="The Clockmaker's Fox" \
  DV_BOXSET="The Meridian Trilogy" ./run.sh shots \
  01-library-posters 01b-library-wall 04-film-detail 05-boxset-detail \
  08-watchlist-posters 10-wishlist 12-statistics m01b m02
```

Two parts of the interface stay dark in the light theme, by the app's own
design: the featured band at the top of the library and the header of a film
page. That is not a fault in the screenshot.

The first virtualenv is created by hand, once:

```sh
uv venv venv && uv pip install -p venv -r "$DV_REPO/app/backend/requirements.txt"
```

## Filling a slot

Crop or scale the screenshot, save it as `still.webp` in the slot's folder
under `src/assets/media/`, and rebuild. The light screenshot of the same view
goes next to it as `still-light.webp`, with the same filter, so both have the
same size. The crops in use:

| Slot | From | ffmpeg filter |
| --- | --- | --- |
| `hero` | `01b-library-wall` | `scale=2880:-1` |
| `self-hosted-library` | `01-library-posters` | `crop=3200:1800:0:0,scale=2880:-1` |
| `self-hosted-detail`, `-boxset`, `-lists` | `04-film-detail`, `05-boxset-detail`, `08-watchlist-posters` | `scale=1920:-1` |
| `collect-library`, `collect-detail` | `m01b-library-grid`, `m02-film-detail` | `crop=1170:1560:0:0,scale=960:-1` |
| `collect-lists` | `10-wishlist-price-alerts` | `crop=870:1160:530:640` |
| `collect-insight` | `12-statistics` | `crop=810:1080:490:680` |

## The hero loop

`tools/film.mjs` renders the library scrolling down and back as 192 JPEG
frames from the running instance:

```sh
cd media-source/tools && ./run.sh start
set -a; . ./.demo-env; set +a
node film.mjs hero frames/hero
ffmpeg -framerate 24 -i frames/hero/f%04d.jpg -an -vf scale=1280:800:flags=lanczos \
  -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart loop.mp4
ffmpeg -framerate 24 -i frames/hero/f%04d.jpg -an -vf scale=1280:800:flags=lanczos \
  -c:v libvpx-vp9 -b:v 0 -crf 43 -row-mt 1 loop.webm
```

Both files go into `src/assets/media/hero/`. Each must stay under 1.5 MB.

The light loop is the same recipe with `DV_THEME=light node film.mjs hero
frames/hero-light`, encoded to `loop-light.mp4` and `loop-light.webm`.

## The disc

`kit/disc-still.png` is a generated studio picture of the DiscVault disc, made
from the app icon. The loop in `src/assets/media/disc/` was generated from
that still with identical first and last frames, then cropped square.

## Promo film, share image and banner

- `kit/og.html` and `kit/banner.html` render to 1200 × 630 and 1600 × 500 with
  `node shot2.cjs <file> <out.png> <width> <height> [scale]`. They expect
  `inter.woff2`, `mark.png` and covers named `p-NN.png` beside them (copy the
  font from `public/fonts/`, the mark from `public/brand/` and the covers
  from `library/posters/`).
- `promo/promo.html` is a timeline: `window.renderAt(seconds)` draws any
  moment, and `render.cjs landscape|portrait <outDir> 30` writes every frame.
  It expects `disc/dNNNN.jpg` (frames of the disc loop), `lib/fNNNN.jpg` (the
  hero frames), `inter.woff2`, `mark.png` and `cover.png` beside it.
- `appstore/make.cjs` reads `panels.json` and writes one PNG per panel. Put
  real iPhone screenshots in `appstore/in/`; the App Store accepts no
  screenshots of anything but the app itself.

# DiscVault marketing site

Static marketing site for [DiscVault](https://github.com/helmerzNL/DiscVault),
published at [discvault.eu](https://discvault.eu). It uses Astro, TypeScript and
pnpm and produces a self-contained `dist/` directory.

## Requirements and setup

- Node.js 24 or newer
- Corepack

```sh
corepack install --global pnpm@11.13.0
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:setup
```

The hook setup configures this checkout's `core.hooksPath` to `.githooks`.
There is no runtime configuration and no required `.env` file. Local `.env`
files are ignored.

## Run and stop

```sh
corepack pnpm dev       # local development server
corepack pnpm preview   # preview an existing production build
```

Both servers run in the foreground. Stop them with `Ctrl+C`; `corepack pnpm stop`
prints the same operational instruction because the deployed site has no
server process.

## Build, health and checks

```sh
corepack pnpm build          # reproducible static build in dist/
corepack pnpm health         # build plus links and critical-route smoke checks
corepack pnpm check          # complete release gate
corepack pnpm format         # apply repository formatting
corepack pnpm lighthouse     # local Lighthouse budgets (Chromium required)
```

The complete gate checks formatting, generated Chrome & Blue brand tokens,
Astro/TypeScript, all 20 locale models, the build, internal links, protected
legal/Legacy routes, responsive image output and synchronized versions.

Install the project browser once with
`corepack pnpm exec playwright install chromium` before running Lighthouse.
CI runs performance, accessibility, best-practices and SEO budgets for English,
Dutch and the legal shell.

To inspect a build manually:

```sh
corepack pnpm preview
curl --fail http://localhost:4321/
curl --fail http://localhost:4321/privacy.html
curl --fail http://localhost:4321/legacy/
```

## Architecture and data locations

- `src/pages/` — English `/`, 19 generated `/<locale>/` routes, legal `.html`
  routes and the FAQ compatibility route.
- `src/content/locales/` — one parity-checked marketing content shape per
  locale; `src/content/types.ts` is the typed model. Locale files hold copy
  only: order, anchors and the demo films live in `src/content/structure.ts`.
- `src/content/legal/` — preserved EN/NL legal bodies rendered by one
  accessible Astro legal shell.
- `src/components/` and `src/layouts/` — the shell (`Header`, `Footer`), one
  component per homepage chapter in `sections/`, and the shared `media/` and
  `ui/` parts.
- `src/styles/` — `tokens*.css` are generated brand tokens; `theme.css` holds
  the site's own tokens (chapter fields, type steps, spacing), which only
  alias brand tokens; `base.css`, `shell.css`, `legal.css` and one file per
  chapter in `sections/`.
- `src/design/tokens.json` — Chrome & Blue v3.1 source imported from
  `Flux76HQ/App-Guidance`; `corepack pnpm brand:build` generates
  `src/styles/tokens.css`.
- `src/assets/media/<slot>/` — one folder per media slot: `still.webp` (or
  `.png`/`.jpg`) and, optionally, a muted loop as `loop.webm` plus `loop.mp4`.
  Astro turns stills into responsive AVIF/WebP; `src/media/registry.ts` finds
  the files. See "Media" below.
- `src/assets/posters/` — covers of the demo shelf: invented films with
  generated artwork, so the site shows no artwork it has no right to.
- `public/legacy/`, `public/images/upgrade-message/` and
  `public/images/v26-migration/` — preserved Legacy page and its proven image
  dependencies.
- `public/` — immutable files copied directly to the build, including `CNAME`,
  robots and official logo assets.
- `dist/` — disposable deployment artifact. Never edit it directly.
- `docs/` — internal App Store reference material; it is not published.

This is a static site. It has no database, writable runtime storage, analytics
or user data.

## Content and brand updates

1. Update the typed locale files and keep every locale at parity.
2. If brand tokens change, replace `src/design/tokens.json`, update
   `src/design/source.json`, then run `pnpm brand:build`.
3. To replace a screenshot or a loop, drop the new file into its slot folder
   under `src/assets/media/` (see "Media" below). No code changes.
4. Run `corepack pnpm format` and `corepack pnpm check`.
5. Set the release version idempotently:

   ```sh
   corepack pnpm version:set 1.0.1
   ```

Protected runtime, content, style, asset, script, config, deployment and
workflow paths require `VERSION` to be part of the same staged change.

## Media

The homepage is built from media slots. A slot is a folder under
`src/assets/media/`; a component names the slot and the registry supplies
whatever is in it.

| Slot                                                                    | Shows                                          | Used in                |
| ----------------------------------------------------------------------- | ---------------------------------------------- | ---------------------- |
| `hero`                                                                  | the library as a wall of covers (still + loop) | first screen           |
| `collect-library`, `collect-detail`, `collect-lists`, `collect-insight` | portrait crops of the interface                | "Built for collectors" |
| `collect-iphone`                                                        | an iPhone screenshot (empty until supplied)    | "Built for collectors" |
| `self-hosted-library`, `-detail`, `-boxset`, `-lists`                   | the self-hosted edition in a browser           | "On a server you run"  |
| `disc`                                                                  | the DiscVault disc (still + loop)              | closing row            |

Rules:

- A still is required for a slot to render; a slot without one renders
  nothing (optional slots) or a flat placeholder.
- A loop needs both `loop.webm` and `loop.mp4`, no audio track, at most 1.5 MB
  each (aim for 900 KB mp4 and 600 KB webm, 6–10 s, 1280–1440 px wide). The
  still is its poster and its fallback.
- Loops never autoplay by attribute: `src/scripts/media.ts` starts one only
  while it is on screen, never under reduced motion or Save-Data, and gives
  it a pause control.
- Screenshots show the demo shelf of invented films, dark theme, the Blu-ray
  accent and the English interface. Do not publish real film artwork.
- No Git LFS: GitHub Pages does not serve it. Commit final encodes only.

The design this implements, and the reasons for these rules, are in
`Flux76HQ/App-Guidance`: `projects/discvault/website/chrome-and-blue-web.md`
and ADR-0021.

## Deploy and release channels

Pushing `master` runs the stable Pages workflow. It installs from
`pnpm-lock.yaml`, runs the complete gate and uploads **only `dist/`**.

- Stable releases: `VERSION` and `package.json` use `X.Y.Z`; tag `vX.Y.Z`.
  Stable versions may deploy to Pages.
- Beta releases: version files use `X.Y.Z-beta.N`; tag `vX.Y.Z-beta.N`.
  They create a GitHub prerelease and do not deploy to the production Pages
  channel.

The tag workflow rejects any tag that does not exactly match both version
files.

## Rollback, backup and recovery

There is no runtime data to back up. Git history, release tags and the lockfile
are the complete backup.

To roll back production, redeploy a known-good stable commit from `master` (or
revert the faulty commit and let the Pages workflow rebuild it). To verify a
candidate before deployment, check out its tag, run `corepack pnpm install
--frozen-lockfile && corepack pnpm health`, and compare the generated `dist/`. Do not
restore an old repository-root artifact: Pages must always receive a fresh,
validated `dist/`.

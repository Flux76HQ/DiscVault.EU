# Self-hosted typeface

The site sets everything in Inter, the typeface of the DiscVault house style
(see the design source in `Flux76HQ/App-Guidance`,
`projects/discvault/website/chrome-and-blue-web.md`). Inter is licensed under
the SIL Open Font License 1.1; the licence text is `OFL-inter.txt`. No font
request leaves discvault.eu.

## Files

One variable file per script, weights 100–900 on the `wght` axis:

| File                        | Bytes  | Loaded when a page contains        |
| --------------------------- | ------ | ---------------------------------- |
| `inter-var-latin.woff2`     | 48,256 | Latin (every page)                 |
| `inter-var-latin-ext.woff2` | 85,068 | Latin Extended (cs, hu, pl, tr, …) |
| `inter-var-greek.woff2`     | 18,996 | Greek (el)                         |
| `inter-var-cyrillic.woff2`  | 18,748 | Cyrillic (uk)                      |

Total 171,068 bytes (167.1 KB). An English page loads the Latin file only,
47.1 KB. Budget: ≤ 220 KB in total, one preload (the Latin file). Japanese,
Korean and Chinese fall back to the system typeface.

## Where they come from

The files are the `wght`-axis subsets of `@fontsource-variable/inter` 5.3.0
(`files/inter-<script>-wght-normal.woff2`), copied unchanged and renamed. The
`unicode-range` of each `@font-face` in `src/styles/fonts.css` is the range
that package declares for the same file, so a browser fetches a script only
when the page uses it.

To update: `npm pack @fontsource-variable/inter@<version>`, copy the four
files over these, and copy the matching `unicode-range` values from the
package's `index.css` if they changed.

## Fallback

`Inter Fallback` in `src/styles/fonts.css` is a metric-matched local face
(Arial, `size-adjust: 107%` with ascent, descent and line-gap overrides), so
the swap from the fallback to Inter does not move the layout.

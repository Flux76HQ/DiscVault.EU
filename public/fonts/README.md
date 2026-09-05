# Self-hosted typefaces

The three voices of the marketing routes (see the design series in
`Flux76HQ/App-Guidance`, `projects/discvault/website/`): Instrument Serif for
narrative lines, Martian Mono for slates, Inter for reading copy. All three
are licensed under the SIL Open Font License 1.1; the licence texts are next
to the files. No font request leaves discvault.eu.

## Files

| File                                       | Bytes  |
| ------------------------------------------ | ------ |
| `instrument-serif-italic-latin-ext.woff2`  | 7,544  |
| `instrument-serif-italic-latin.woff2`      | 15,112 |
| `instrument-serif-regular-latin-ext.woff2` | 7,196  |
| `instrument-serif-regular-latin.woff2`     | 14,632 |
| `inter-medium-latin-ext.woff2`             | 28,800 |
| `inter-medium-latin.woff2`                 | 19,392 |
| `inter-regular-latin-ext.woff2`            | 27,768 |
| `inter-regular-latin.woff2`                | 18,896 |
| `martian-mono-regular-latin-ext.woff2`     | 6,032  |
| `martian-mono-regular-latin.woff2`         | 8,420  |

Total 153,792 bytes (150.2 KB); a Latin-only locale loads the five
`-latin` files, 76,452 bytes (74.7 KB). Budget: ≤ 160 KB total.

## How they were made

Sources: the Google Fonts repository (`ofl/instrumentserif`, `ofl/martianmono`,
`ofl/inter`, main branch, 2026-09-05). Variable fonts were instanced to a
single static instance first, then every face was subset to two
`unicode-range` blocks (Latin and Latin Extended, the ranges Google Fonts
uses) and written as woff2 with hinting removed. With fonttools 4.x:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

static = instancer.instantiateVariableFont(TTFont('MartianMono[wdth,wght].ttf'), {'wdth': 100, 'wght': 400})
opts = subset.Options(flavor='woff2', hinting=False, desubroutinize=True,
                      layout_features=['kern', 'liga', 'calt', 'tnum', 'pnum', 'ss01'])
s = subset.Subsetter(opts)
s.populate(unicodes=subset.parse_unicodes(LATIN_RANGE))
s.subset(static)
static.flavor = 'woff2'
static.save('martian-mono-regular-latin.woff2')
```

Inter instances: `opsz` 14, `wght` 400 and 500. Instrument Serif is static.

Ranges:

- Latin: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212,
U+2215, U+FEFF, U+FFFD`
- Latin Extended: `U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7,
U+02DD-02FF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020,
U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF`

Greek (`el`), Cyrillic (`uk`), Japanese, Chinese and Korean fall back to the
system serif and sans stacks declared in `src/styles/cinematic.css`.

## Fallback metrics

`src/styles/cinematic.css` declares a metric-matched fallback face per voice
(`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`)
so text does not move when the real face arrives. The overrides come from the
fonts' own `hhea` metrics (Instrument Serif 990/−310 per 1000; Martian Mono
1000/−200 per 1000; Inter 1984/−494 per 2048) divided by the `size-adjust`;
the `size-adjust` values are the average-width ratio against Georgia, Menlo
and Arial and are re-measured in build plan prompt 12 on a machine that has
those faces.

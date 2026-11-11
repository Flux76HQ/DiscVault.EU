/**
 * Media slots. A slot is a folder under src/assets/media/ holding a still
 * (`still.png|jpg|webp`) and, optionally, a muted loop (`loop.webm` and
 * `loop.mp4`). Components name a slot; dropping files into its folder fills
 * it without a code change. A slot with no still renders a placeholder, so a
 * page can ship before every screenshot exists.
 *
 * The page follows the visitor's light or dark scheme, and a screenshot of
 * an interface has a scheme of its own. So a slot may also hold the same
 * picture taken in the light interface: `still-light.*`, and with it
 * `loop-light.webm` and `loop-light.mp4`. The plain files are the dark ones.
 * A slot without light files shows its one picture in both schemes, which is
 * right for anything that is not an interface (the disc).
 */
import type { ImageMetadata } from 'astro';

const stills = import.meta.glob<ImageMetadata>(
  '../assets/media/*/still.{png,jpg,jpeg,webp}',
  { eager: true, import: 'default' },
);
const webmLoops = import.meta.glob<string>('../assets/media/*/loop.webm', {
  eager: true,
  query: '?url',
  import: 'default',
});
const mp4Loops = import.meta.glob<string>('../assets/media/*/loop.mp4', {
  eager: true,
  query: '?url',
  import: 'default',
});
const lightStills = import.meta.glob<ImageMetadata>(
  '../assets/media/*/still-light.{png,jpg,jpeg,webp}',
  { eager: true, import: 'default' },
);
const lightWebmLoops = import.meta.glob<string>(
  '../assets/media/*/loop-light.webm',
  { eager: true, query: '?url', import: 'default' },
);
const lightMp4Loops = import.meta.glob<string>(
  '../assets/media/*/loop-light.mp4',
  { eager: true, query: '?url', import: 'default' },
);

const bySlot = <T>(modules: Record<string, T>) =>
  Object.fromEntries(
    Object.entries(modules).map(([path, value]) => [
      path.match(/media\/([^/]+)\//)?.[1] ?? path,
      value,
    ]),
  ) as Record<string, T>;

const stillBySlot = bySlot(stills);
const webmBySlot = bySlot(webmLoops);
const mp4BySlot = bySlot(mp4Loops);
const lightStillBySlot = bySlot(lightStills);
const lightWebmBySlot = bySlot(lightWebmLoops);
const lightMp4BySlot = bySlot(lightMp4Loops);

export interface MediaLoop {
  webm: string;
  mp4: string;
}

export interface MediaSlot {
  still?: ImageMetadata;
  /** A loop needs both encodings; one alone is ignored. */
  loop?: MediaLoop;
  /**
   * The same picture in the light interface. Only set when the slot has a
   * dark still and a light still: a light file on its own is ignored.
   */
  light?: { still: ImageMetadata; loop?: MediaLoop };
}

const pair = (webm?: string, mp4?: string): MediaLoop | undefined =>
  webm && mp4 ? { webm, mp4 } : undefined;

export function mediaSlot(slot: string): MediaSlot {
  const still = stillBySlot[slot];
  const lightStill = lightStillBySlot[slot];
  return {
    still,
    loop: pair(webmBySlot[slot], mp4BySlot[slot]),
    light:
      still && lightStill
        ? {
            still: lightStill,
            loop: pair(lightWebmBySlot[slot], lightMp4BySlot[slot]),
          }
        : undefined,
  };
}

const posters = import.meta.glob<ImageMetadata>('../assets/posters/*.webp', {
  eager: true,
  import: 'default',
});
const posterBySlug = Object.fromEntries(
  Object.entries(posters).map(([path, value]) => [
    path.match(/posters\/([^/]+)\.webp$/)?.[1] ?? path,
    value,
  ]),
) as Record<string, ImageMetadata>;

/** A cover from the demo shelf of invented films. */
export function poster(slug: string): ImageMetadata {
  const image = posterBySlug[slug];
  if (!image) throw new Error(`No demo poster for "${slug}"`);
  return image;
}

/**
 * Media slots. A slot is a folder under src/assets/media/ holding a still
 * (`still.png|jpg|webp`) and, optionally, a muted loop (`loop.webm` and
 * `loop.mp4`). Components name a slot; dropping files into its folder fills
 * it without a code change. A slot with no still renders a placeholder, so a
 * page can ship before every screenshot exists.
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

export interface MediaSlot {
  still?: ImageMetadata;
  /** A loop needs both encodings; one alone is ignored. */
  loop?: { webm: string; mp4: string };
}

export function mediaSlot(slot: string): MediaSlot {
  const webm = webmBySlot[slot];
  const mp4 = mp4BySlot[slot];
  return {
    still: stillBySlot[slot],
    loop: webm && mp4 ? { webm, mp4 } : undefined,
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

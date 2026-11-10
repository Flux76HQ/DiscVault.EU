/**
 * The structure of the homepage: which items exist and in what order. Copy
 * for each id lives in the locale files; nothing here is translated.
 */
export const featureIds = [
  'library',
  'detail',
  'lists',
  'insight',
  'iphone',
] as const;
export type FeatureId = (typeof featureIds)[number];

export const editionIds = [
  'uhd',
  'bluray',
  'dvd',
  'steelbook',
  'boxset',
] as const;
export type EditionId = (typeof editionIds)[number];

export const platformRowIds = [
  'home',
  'add',
  'share',
  'signin',
  'extras',
  'languages',
] as const;
export type PlatformRowId = (typeof platformRowIds)[number];

export const shotIds = ['library', 'detail', 'boxset', 'lists'] as const;
export type ShotId = (typeof shotIds)[number];

export const privacyTileIds = ['ads', 'trackers', 'profiles', 'count'] as const;
export type PrivacyTileId = (typeof privacyTileIds)[number];

export const faqIds = [
  'server',
  'account',
  'data',
  'sends',
  'sync',
  'export',
  'android',
  'legacy',
] as const;
export type FaqId = (typeof faqIds)[number];

/**
 * The demo shelf: invented films, so no page of this site shows artwork it
 * has no right to. The scan chapter looks these up by barcode. The barcodes
 * use the GS1 in-store prefix (2), so none can belong to a real product.
 */
export interface DemoFilm {
  slug: string;
  title: string;
  year: number;
  format: '4K UHD' | 'Blu-ray' | 'DVD';
  badge: 'uhd' | 'bluray' | 'dvd';
  runtime: number;
  director: string;
  barcode: string;
}

export const scanFilms: DemoFilm[] = [
  {
    slug: 'the-clockmakers-fox',
    title: 'The Clockmaker’s Fox',
    year: 2019,
    format: '4K UHD',
    badge: 'uhd',
    runtime: 95,
    director: 'Bastien Leroux',
    barcode: '2 009992 240195',
  },
  {
    slug: 'velvet-alibi',
    title: 'Velvet Alibi',
    year: 2019,
    format: 'Blu-ray',
    badge: 'bluray',
    runtime: 110,
    director: 'Raymond Castellan',
    barcode: '2 009992 350191',
  },
  {
    slug: 'ironwood-trail',
    title: 'Ironwood Trail',
    year: 2013,
    format: 'DVD',
    badge: 'dvd',
    runtime: 114,
    director: 'Clay Barrett',
    barcode: '2 009992 330131',
  },
  {
    slug: 'orbit-of-ash',
    title: 'Orbit of Ash',
    year: 2023,
    format: '4K UHD',
    badge: 'uhd',
    runtime: 128,
    director: 'Mara Lindqvist',
    barcode: '2 009992 010231',
  },
];

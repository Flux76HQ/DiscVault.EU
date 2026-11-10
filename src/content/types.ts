/**
 * The marketing content model: one shape for all twenty locales. Locale files
 * hold copy only; order, anchors, media slots and link targets live in
 * `structure.ts`, so a translation cannot change the page's structure.
 * Design source: Flux76HQ/App-Guidance,
 * projects/discvault/website/chrome-and-blue-web.md.
 */
import type {
  EditionId,
  FaqId,
  FeatureId,
  PlatformRowId,
  PrivacyTileId,
  ShotId,
} from './structure';

export interface FeatureBlock {
  title: string;
  points: string[];
  mediaAlt: string;
}

export interface MarketingContent {
  locale: string;
  languageName: string;
  seo: { title: string; description: string; ogAlt: string };
  a11y: {
    skip: string;
    home: string;
    menu: string;
    language: string;
    sections: string;
    pauseMotion: string;
    playMotion: string;
  };
  nav: {
    collect: string;
    scan: string;
    editions: string;
    selfHosted: string;
    privacy: string;
    faq: string;
    docs: string;
    get: string;
  };
  actions: {
    appStore: string;
    selfHost: string;
    android: string;
    testflight: string;
    installGuide: string;
    migrationGuide: string;
    privacyPolicy: string;
    discord: string;
    github: string;
    issues: string;
    support: string;
    moreAnswers: string;
    backToTop: string;
  };
  hero: { title: string; lead: string; note: string; mediaAlt: string };
  collect: { title: string; blocks: Record<FeatureId, FeatureBlock> };
  scan: {
    titleStart: string;
    titleEnd: string;
    lead: string;
    record: {
      format: string;
      year: string;
      runtime: string;
      minutes: string;
      director: string;
      barcode: string;
      added: string;
    };
    note: string;
    fallback: string;
  };
  editions: {
    title: string;
    lead: string;
    items: Record<EditionId, { name: string; detail: string }>;
    note: string;
  };
  platforms: {
    title: string;
    lead: string;
    columns: {
      ios: { name: string; sub: string };
      selfHosted: { name: string; sub: string };
    };
    rows: Record<
      PlatformRowId,
      { label: string; ios: string; selfHosted: string }
    >;
    android: { title: string; body: string };
    roadmap: string;
  };
  selfHosted: {
    title: string;
    lead: string;
    shots: Record<ShotId, { label: string; alt: string }>;
    points: string[];
    migration: { title: string; body: string };
  };
  runs: { title: string; names: string[]; caption: string };
  privacy: {
    title: string;
    lead: string;
    tiles: Record<PrivacyTileId, { figure: string; label: string }>;
    body: [string, string];
  };
  plans: {
    titleStart: string;
    titleFree: string;
    titleEnd: string;
    lead: string;
    points: string[];
    support: string;
  };
  faq: {
    title: string;
    items: Record<FaqId, { question: string; answer: string[] }>;
  };
  cta: { title: string; lead: string };
  footer: {
    tagline: string;
    groups: { product: string; help: string; legal: string };
    privacy: string;
    terms: string;
    legacy: string;
    production: string;
    tmdb: string;
  };
}

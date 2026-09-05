/**
 * The marketing content model: seven reels, one shape for all twenty locales.
 * Design source: Flux76HQ/App-Guidance, projects/discvault/website/
 * (experience-architecture.md §10, hero.md §3).
 */

/** A voice line in segments; the segment at index 1 is emphasised. */
export type Segments = [string, string] | [string, string, string];

/** Slate facts; the component joins them with a hair-spaced middle dot. */
export type Slate = string[];

export interface Reel {
  slate: Slate;
  voice: Segments;
  lead: string;
}

export interface FormatRoute {
  id: 'self-hosted' | 'ios' | 'android';
  slate: Slate;
  title: string;
  body: string[];
  action: string;
}

export interface Credit {
  role: string;
  name: string;
}

export interface MarketingContent {
  locale: string;
  languageName: string;
  seo: {
    title: string;
    description: string;
  };
  nav: {
    library: string;
    scan: string;
    editions: string;
    privacy: string;
    install: string;
    docs: string;
    menu: string;
    language: string;
  };
  actions: {
    install: string;
    installCompact: string;
    appStore: string;
    android: string;
    testflight: string;
    privacy: string;
  };
  leader: Reel & { note: Slate };
  shelf: Reel & { counter: Slate };
  read: Reel & { note: Slate; captureAlt: string };
  edition: Reel & { spines: string[] };
  vault: Reel & { body: string[] };
  formats: Reel & {
    routes: [FormatRoute, FormatRoute, FormatRoute];
    roadmap: string;
    migration: Slate;
  };
  credits: {
    install: Credit;
    appStore: Credit;
    android: Credit;
    testflight: Credit;
    source: Credit;
    community: Credit;
    issues: Credit;
    languages: Credit;
    privacy: Credit;
    terms: Credit;
    legacy: Credit;
    production: Credit;
    final: Segments;
  };
  footer: {
    tagline: string;
    source: string;
    legacy: string;
    privacy: string;
    terms: string;
    support: string;
  };
}

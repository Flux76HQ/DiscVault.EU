/**
 * Temporary bridge (build plan prompt 3): derives the shape the previous
 * marketing markup expects from the reel model, so the old page keeps
 * compiling and the route contract stays green while the reels replace it
 * one section at a time (prompts 4–7). Deleted in prompt 7.
 */
import type { MarketingContent, Slate } from './types';

const HAIR = ' ';
export const joinSlate = (slate: Slate): string =>
  slate.join(`${HAIR}·${HAIR}`);
const joinVoice = (segments: readonly string[]): string => segments.join('');

export interface LegacyRoute {
  label: string;
  title: string;
  body: string;
  points: string[];
}

export interface LegacyMarketingContent {
  locale: string;
  nav: {
    product: string;
    ios: string;
    selfHosted: string;
    privacy: string;
    docs: string;
    menu: string;
    language: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    accent: string;
    lead: string;
    appStore: string;
    androidBeta: string;
    selfHosted: string;
  };
  routes: {
    eyebrow: string;
    heading: string;
    mobileRoadmap: string;
    ios: LegacyRoute;
    selfHosted: LegacyRoute;
  };
  capabilities: {
    eyebrow: string;
    heading: string;
    items: Array<{ title: string; body: string }>;
  };
  showcase: {
    eyebrow: string;
    heading: string;
    mobileLibrary: string;
    mobileAdd: string;
    mobileDetail: string;
    desktopLibrary: string;
    desktopDetail: string;
  };
  trust: {
    eyebrow: string;
    heading: string;
    body: string;
    noTrackingTitle: string;
    noTrackingBody: string;
    controlTitle: string;
    controlBody: string;
  };
  comparison: {
    eyebrow: string;
    heading: string;
    route: string;
    bestFor: string;
    setup: string;
    iosBest: string;
    iosSetup: string;
    androidSetup: string;
    selfBest: string;
    selfSetup: string;
  };
  community: {
    eyebrow: string;
    heading: string;
    discord: string;
    issues: string;
    support: string;
    finalTitle: string;
  };
  footer: MarketingContent['footer'];
}

export function toLegacy(c: MarketingContent): LegacyMarketingContent {
  const [selfHosted, ios, android] = c.formats.routes;
  return {
    locale: c.locale,
    nav: {
      product: c.nav.library,
      ios: ios.title,
      selfHosted: selfHosted.title,
      privacy: c.nav.privacy,
      docs: c.nav.docs,
      menu: c.nav.menu,
      language: c.nav.language,
    },
    hero: {
      eyebrow: joinSlate(c.leader.slate),
      title: joinVoice(c.leader.voice),
      accent: c.footer.tagline,
      lead: c.leader.lead,
      appStore: c.actions.appStore,
      androidBeta: c.actions.android,
      selfHosted: c.actions.installCompact,
    },
    routes: {
      eyebrow: c.nav.install,
      heading: joinVoice(c.formats.voice),
      mobileRoadmap: c.formats.roadmap,
      ios: {
        label: ios.title,
        title: joinSlate(ios.slate),
        body: ios.body[0],
        points: [c.read.lead, c.shelf.lead],
      },
      selfHosted: {
        label: selfHosted.title,
        title: joinSlate(selfHosted.slate),
        body: selfHosted.body[0],
        points: selfHosted.body.slice(1),
      },
    },
    capabilities: {
      eyebrow: c.nav.library,
      heading: c.formats.lead,
      items: [
        { title: joinVoice(c.shelf.voice), body: c.shelf.lead },
        { title: joinVoice(c.read.voice), body: c.read.lead },
        { title: joinVoice(c.edition.voice), body: c.edition.lead },
        { title: joinVoice(c.vault.voice), body: c.vault.lead },
        { title: selfHosted.title, body: selfHosted.body[0] },
        { title: ios.title, body: ios.body[0] },
      ],
    },
    showcase: {
      eyebrow: c.nav.library,
      heading: joinVoice(c.shelf.voice),
      mobileLibrary: c.shelf.slate[1],
      mobileAdd: c.read.captureAlt,
      mobileDetail: c.edition.slate[1],
      desktopLibrary: c.shelf.slate[1],
      desktopDetail: c.edition.slate[1],
    },
    trust: {
      eyebrow: c.nav.privacy,
      heading: joinVoice(c.vault.voice),
      body: c.vault.lead,
      noTrackingTitle: c.vault.slate[4],
      noTrackingBody: c.vault.body[0],
      controlTitle: c.vault.slate[1],
      controlBody: c.vault.lead,
    },
    comparison: {
      eyebrow: c.nav.install,
      heading: c.formats.lead,
      route: c.nav.install,
      bestFor: c.nav.editions,
      setup: c.nav.docs,
      iosBest: ios.body[0],
      iosSetup: joinSlate(ios.slate),
      androidSetup: android.body[0],
      selfBest: selfHosted.body[0],
      selfSetup: joinSlate(c.formats.migration),
    },
    community: {
      eyebrow: c.credits.community.role,
      heading: c.credits.community.name,
      discord: c.credits.community.name,
      issues: c.credits.issues.role,
      support: c.footer.support,
      finalTitle: joinVoice(c.credits.final),
    },
    footer: c.footer,
  };
}

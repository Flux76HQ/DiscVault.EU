import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const locales = [
  'cs',
  'da',
  'de',
  'el',
  'es',
  'fi',
  'fr',
  'hu',
  'it',
  'ja',
  'ko',
  'nl',
  'no',
  'pl',
  'pt',
  'sv',
  'tr',
  'uk',
  'zh',
];
const appStore = 'https://apps.apple.com/app/discvault/id6788772918';
const testflight = 'https://testflight.apple.com/join/6bJetcyy';
const discord = 'https://discord.gg/zdc88VB8mJ';
const obsoleteDiscord = 'https://discord.gg/6fEXZV8A';
const docs = 'https://docs.discvault.eu/';

function countButtonLinks(
  html,
  href,
  requiredClasses = ['button'],
  excludedClasses = [],
) {
  return [...html.matchAll(/<a\b[^>]*>/g)].filter((match) => {
    const tag = match[0];
    const classes = tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    return (
      tag.includes(`href="${href}"`) &&
      requiredClasses.every((className) => classes.includes(className)) &&
      excludedClasses.every((className) => !classes.includes(className))
    );
  }).length;
}

async function requireFile(relativePath) {
  await access(path.join('dist', relativePath));
  return readFile(path.join('dist', relativePath), 'utf8');
}

const critical = [
  'legacy/index.html',
  'privacy.html',
  'privacy-nl.html',
  'terms.html',
  'terms-nl.html',
];
await Promise.all(critical.map(requireFile));
await access(path.join('dist', 'brand', 'discvault-logo-transparent.png'));

for (const [name, phrase] of Object.entries({
  'privacy.html': 'DiscVault for iOS, iPadOS, and Android',
  'privacy-nl.html': 'DiscVault voor iOS, iPadOS en Android',
  'terms.html': 'Acceptance of these terms',
  'terms-nl.html': 'Aanvaarding van deze voorwaarden',
})) {
  const built = await requireFile(name);
  const source = await readFile(`src/content/legal/${name}`, 'utf8');
  if (!built.includes(source.trim()) || !built.includes(phrase)) {
    throw new Error(`${name} did not preserve its legal body verbatim`);
  }

  const documentType = name.startsWith('privacy') ? 'privacy' : 'terms';
  const legalAlternates = [
    `hreflang="en" href="https://discvault.eu/${documentType}.html"`,
    `hreflang="nl" href="https://discvault.eu/${documentType}-nl.html"`,
    `hreflang="x-default" href="https://discvault.eu/${documentType}.html"`,
  ];
  for (const alternate of legalAlternates) {
    if (!built.includes(alternate)) {
      throw new Error(`${name} is missing legal alternate ${alternate}`);
    }
  }
  const alternates = [...built.matchAll(/rel="alternate" hreflang=/g)].length;
  if (alternates !== legalAlternates.length) {
    throw new Error(
      `${name} has ${alternates} hreflang links instead of ${legalAlternates.length}`,
    );
  }
}

const privacyClaims = {
  'privacy.html': [
    'DiscVault for iOS, iPadOS, and Android',
    'the apps are standalone and do not upload or sync your collection, watchlist, or watch history',
    'stores it only on your device in secure platform storage',
    'sends lookup requests directly to TMDB over HTTPS',
    'Your TMDB API key or any direct TMDB request.',
    'Your collection, watchlist, or watch history.',
  ],
  'privacy-nl.html': [
    'DiscVault voor iOS, iPadOS en Android',
    'de apps zijn standalone en uploaden of synchroniseren je collectie, watchlist of kijkgeschiedenis niet',
    'bewaart de app die alleen op je toestel in beveiligde platformopslag',
    'verstuurt de app lookup-verzoeken rechtstreeks via HTTPS naar TMDB',
    'Je TMDB API-key of enig rechtstreeks TMDB-verzoek.',
    'Je collectie, watchlist of kijkgeschiedenis.',
  ],
};
for (const [name, claims] of Object.entries(privacyClaims)) {
  const built = await requireFile(name);
  const normalized = built
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const claim of claims) {
    if (!normalized.includes(claim)) {
      throw new Error(`${name} is missing required privacy claim: ${claim}`);
    }
  }
  if (!built.includes('href="https://www.themoviedb.org/privacy-policy"')) {
    throw new Error(`${name} is missing TMDB's official privacy policy link`);
  }
  for (const obsoleteClaim of [
    'DiscVault — VaultStack',
    'self-hosted DiscVault',
    'Contributing metadata improvements',
    'Bijdragen aan metadataverbeteringen',
  ]) {
    if (normalized.includes(obsoleteClaim)) {
      throw new Error(
        `${name} still contains obsolete claim: ${obsoleteClaim}`,
      );
    }
  }
}

const legacy = await requireFile('legacy/index.html');
const legacyAssets = [...legacy.matchAll(/\.\.\/(images\/[^"']+)/g)].map(
  (match) => match[1],
);
for (const asset of new Set(legacyAssets)) {
  await access(path.join('dist', asset));
}
if (new Set(legacyAssets).size !== 10) {
  throw new Error(
    `Expected 10 proven Legacy image dependencies, found ${new Set(legacyAssets).size}`,
  );
}

const englishHome = await requireFile('index.html');
for (const legacyTarget of ['discvault26', 'migration', 'install']) {
  if (!englishHome.includes(`id="${legacyTarget}"`)) {
    throw new Error(
      `Marketing homepage is missing Legacy target #${legacyTarget}`,
    );
  }
}
if (
  !englishHome.includes('class="credits-list"') ||
  !englishHome.includes('Migrating from Legacy')
) {
  throw new Error(
    'Marketing homepage must render the credits list and the Legacy migration slate',
  );
}

const marketingPages = [
  ['index.html', 'en', 'https://discvault.eu/'],
  ...locales.map((locale) => [
    `${locale}/index.html`,
    locale,
    `https://discvault.eu/${locale}/`,
  ]),
];
for (const [file, locale, canonical] of marketingPages) {
  const html = await requireFile(file);
  const checks = [
    `<html lang="${locale}"`,
    `rel="canonical" href="${canonical}"`,
    appStore,
    testflight,
    discord,
    docs,
    'id="android"',
    'id="product"',
    'id="scan"',
    'id="editions"',
    'hreflang="x-default"',
    'application/ld+json',
  ];
  for (const check of checks) {
    if (!html.includes(check)) {
      throw new Error(`${file} is missing ${check}`);
    }
  }
  const selfHostedButtons = countButtonLinks(
    html,
    docs,
    ['button'],
    ['button-secondary'],
  );
  const selfHostedHeaderButtons = countButtonLinks(html, docs, [
    'button',
    'button-compact',
  ]);
  const selfHostedMobileButtons = countButtonLinks(html, docs, [
    'mobile-menu-primary',
  ]);
  const appStoreButtons = countButtonLinks(html, appStore, [
    'button',
    'button-secondary',
  ]);
  const androidButtons = countButtonLinks(html, discord, [
    'button',
    'button-secondary',
  ]);
  const selfHostedIndex = html.indexOf('id="self-hosted"');
  const iosIndex = html.indexOf('id="ios"');
  const androidIndex = html.indexOf('id="android"');
  const selfHostedArticleStart = html.lastIndexOf('<article', selfHostedIndex);
  const selfHostedArticleEnd = html.indexOf('>', selfHostedArticleStart);
  const selfHostedArticle = html.slice(
    selfHostedArticleStart,
    selfHostedArticleEnd + 1,
  );
  if (
    selfHostedButtons < 4 ||
    selfHostedHeaderButtons !== 1 ||
    selfHostedMobileButtons !== 1 ||
    appStoreButtons < 3 ||
    androidButtons < 3 ||
    selfHostedIndex < 0 ||
    !(selfHostedIndex < iosIndex && iosIndex < androidIndex) ||
    !selfHostedArticle.includes('route-card-featured')
  ) {
    throw new Error(
      `${file} must render Self-hosted first as the featured primary route, with App Store and Android as secondary routes`,
    );
  }
  if (
    countButtonLinks(html, appStore, ['button'], ['button-secondary']) > 0 ||
    countButtonLinks(html, discord, ['button'], ['button-secondary']) > 0 ||
    countButtonLinks(html, testflight) > 0 ||
    html.includes(obsoleteDiscord)
  ) {
    throw new Error(
      `${file} promotes a mobile route as primary or retains the obsolete Discord invite`,
    );
  }
  const alternates = [...html.matchAll(/rel="alternate" hreflang=/g)].length;
  if (alternates !== 21) {
    throw new Error(`${file} has ${alternates} hreflang links instead of 21`);
  }
  if (
    locale === 'nl' &&
    (!html.includes('href="/privacy-nl.html"') ||
      !html.includes('href="/terms-nl.html"') ||
      html.includes('href="/privacy.html"') ||
      html.includes('href="/terms.html"'))
  ) {
    throw new Error(`${file} does not use the preserved Dutch legal routes`);
  }
}

const faq = await requireFile('faq.html');
for (const required of [
  'noindex, follow',
  `rel="canonical" href="${docs}"`,
  `content="0;url=${docs}"`,
  `href="${docs}"`,
]) {
  if (!faq.includes(required)) {
    throw new Error(`faq.html is missing ${required}`);
  }
}

const robots = await requireFile('robots.txt');
if (
  robots.includes('Disallow: /faq.html') ||
  !robots.includes('sitemap-index.xml')
) {
  throw new Error(
    'robots.txt must allow FAQ noindex discovery and advertise the sitemap',
  );
}
await requireFile('sitemap-index.xml');
const sitemap = await requireFile('sitemap-0.xml');
for (const legalRoute of [
  'privacy.html',
  'privacy-nl.html',
  'terms.html',
  'terms-nl.html',
]) {
  if (
    !sitemap.includes(`https://discvault.eu/${legalRoute}`) ||
    sitemap.includes(`https://discvault.eu/${legalRoute}/`)
  ) {
    throw new Error(`Sitemap does not contain exact route /${legalRoute}`);
  }
}
if (sitemap.includes('faq.html')) {
  throw new Error('FAQ compatibility route must not appear in the sitemap');
}
if ((await requireFile('CNAME')).trim() !== 'discvault.eu') {
  throw new Error('CNAME was not preserved');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : target;
      }),
    )
  ).flat();
}

const outputFiles = await walk('dist');
if (!outputFiles.some((file) => file.endsWith('.avif'))) {
  throw new Error('No optimized AVIF showcase assets were emitted');
}
if (!outputFiles.some((file) => file.endsWith('.webp'))) {
  throw new Error('No optimized WebP showcase assets were emitted');
}

console.log(
  `Critical route smoke passed: ${critical.length} protected routes, ${marketingPages.length} locale routes, FAQ fallback, SEO, and responsive assets`,
);

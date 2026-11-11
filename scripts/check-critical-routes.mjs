import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  byId,
  descendants,
  findAll,
  hasClass,
  innerHtml,
  parseHtml,
  textOf,
} from './lib/html.mjs';

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

/**
 * Link targets come from src/config.ts, the file the components import, so
 * the gate cannot drift from the site by carrying its own copy of a URL.
 * Handles the three forms that file uses: a quoted string, a template that
 * refers to an earlier constant, and a bare alias.
 */
async function readConfig() {
  const source = await readFile('src/config.ts', 'utf8');
  const constants = {};
  const resolve = (name) => {
    if (!(name in constants)) {
      throw new Error(`src/config.ts uses ${name} before it is defined`);
    }
    return constants[name];
  };
  for (const [, name, raw] of source.matchAll(
    /export const (\w+)\s*=\s*([^;]+);/g,
  )) {
    const value = raw.trim();
    const quoted = value.match(/^(['"])([^'"]*)\1$/);
    const template = value.match(/^`([^`]*)`$/);
    if (quoted) {
      constants[name] = quoted[2];
    } else if (template) {
      constants[name] = template[1].replace(/\$\{(\w+)\}/g, (match, ref) =>
        resolve(ref),
      );
    } else if (/^\w+$/.test(value)) {
      constants[name] = resolve(value);
    } else {
      throw new Error(`src/config.ts: cannot read the value of ${name}`);
    }
  }
  return constants;
}

const config = await readConfig();
for (const name of [
  'APP_STORE_URL',
  'TESTFLIGHT_URL',
  'DISCORD_URL',
  'ANDROID_BETA_SIGNUP_URL',
  'DOCS_URL',
  'LEGACY_PATH',
]) {
  if (!config[name]) throw new Error(`src/config.ts does not export ${name}`);
}
const appStore = config.APP_STORE_URL;
const testflight = config.TESTFLIGHT_URL;
const discord = config.DISCORD_URL;
const androidBeta = config.ANDROID_BETA_SIGNUP_URL;
const docs = config.DOCS_URL;
const legacyPath = config.LEGACY_PATH;
const obsoleteDiscord = 'https://discord.gg/6fEXZV8A';
// The host a self-hosted server reports its daily count to (ADR-0020).
const installationCountHost = 'api.discvault.eu';

// Failures of the 3.0 contract are collected and reported together; the
// protected-route assertions below still stop at the first breach.
const failures = [];
const fail = (message) => failures.push(message);

async function requireFile(relativePath) {
  await access(path.join('dist', relativePath));
  return readFile(path.join('dist', relativePath), 'utf8');
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

const critical = [
  'legacy/index.html',
  'privacy.html',
  'privacy-nl.html',
  'terms.html',
  'terms-nl.html',
];
await Promise.all(critical.map(requireFile));
await access(path.join('dist', 'brand', 'discvault-logo-transparent.png'));

/**
 * Byte pins. The Legacy page, the stylesheet it loads and the favicon are
 * preserved files: release 3.0 replaces the homepage, not these. Each must
 * reach dist/ byte-identical to the file in git.
 */
const pinned = {
  'legacy/index.html':
    '46bb201628d4ac265b495ba33e5755d77fb04985f39750fe8f02ba4f70651504',
  'styles.css':
    '0fc5ae137868e7a097ff26d277f20b7f50939670e6e67eabe1f62af291c8ced9',
  'favicon.svg':
    '3bf5a581fe1d259371d1b695f3236a17063d52b170f0c011c7fc764768a4d830',
};
for (const [file, expected] of Object.entries(pinned)) {
  for (const directory of ['public', 'dist']) {
    const target = path.join(directory, file);
    const actual = createHash('sha256')
      .update(await readFile(target))
      .digest('hex');
    if (actual !== expected) {
      throw new Error(
        `${target} is not byte-identical to its pinned version (sha256 ${actual}, expected ${expected})`,
      );
    }
  }
}

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
    // The anonymous installation count (App-Guidance ADR-0020): the policy names
    // the host a server reports to, what we keep, and the operator's off switch.
    'https://api.discvault.eu',
    'daily totals only',
    'DISCVAULT_INSTALLATION_COUNT=off',
  ],
  'privacy-nl.html': [
    'DiscVault voor iOS, iPadOS en Android',
    'de apps zijn standalone en uploaden of synchroniseren je collectie, watchlist of kijkgeschiedenis niet',
    'bewaart de app die alleen op je toestel in beveiligde platformopslag',
    'verstuurt de app lookup-verzoeken rechtstreeks via HTTPS naar TMDB',
    'Je TMDB API-key of enig rechtstreeks TMDB-verzoek.',
    'Je collectie, watchlist of kijkgeschiedenis.',
    'https://api.discvault.eu',
    'alleen dagtotalen',
    'DISCVAULT_INSTALLATION_COUNT=off',
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

/**
 * The 3.0 homepage contract.
 *
 * 2.0 asserted here: three Legacy targets on the English homepage only, a
 * `class="credits-list"` and the text "Migrating from Legacy"; then, per
 * locale, counts of `.button` / `.button-secondary` / `.button-compact` /
 * `.mobile-menu-primary` links per URL, the order self-hosted → ios →
 * android, a `route-card-featured` article, and that neither the App Store
 * nor the Android link was a primary button.
 *
 * Why it changed: release 3.0 replaces the Pressed Light homepage with
 * colour chapters on the house style. The reels, the credits list and the
 * route cards no longer exist, and the App Store and self-hosting are now
 * both a main action, side by side in the hero and in the closing call. The
 * gate reads a link's role and rank from `data-cta` / `data-rank`, not from
 * CSS classes. Design source: Flux76HQ/App-Guidance,
 * projects/discvault/website/chrome-and-blue-web.md, and ADR-0021
 * (decisions 3 and 7).
 */
const anchors = [
  'main',
  'discvault26',
  'product',
  'scan',
  'editions',
  'self-hosted',
  'install',
  'ios',
  'android',
  'migration',
  'privacy',
  'plans',
  'faq',
  'community',
  'footer',
];
const ctaKinds = ['get', 'app-store', 'self-hosted', 'android', 'testflight'];
const ctaRanks = ['primary', 'secondary', 'text'];

const isCta = (kind, rank) => (node) =>
  node.tag === 'a' &&
  node.attrs['data-cta'] === kind &&
  (rank === undefined || node.attrs['data-rank'] === rank);

/** Rules that hold for every `data-cta` link on any page that has a bar. */
function checkCtaLinks(file, document, homePath) {
  const targets = {
    get: (href) => href === `${homePath}#install`,
    'app-store': (href) => href === appStore,
    // The install guide may point deeper into the docs than the docs root.
    'self-hosted': (href) => href.startsWith(docs),
    android: (href) => href === androidBeta,
    testflight: (href) => href === testflight,
  };
  for (const node of descendants(document.root)) {
    const kind = node.attrs['data-cta'];
    const rank = node.attrs['data-rank'];
    if (kind === undefined && rank === undefined) continue;
    const where = `${file}: <${node.tag} data-cta="${kind}" data-rank="${rank}">`;
    if (node.tag !== 'a' || !node.attrs.href) {
      fail(`${where} is not a link with an href`);
      continue;
    }
    if (!ctaKinds.includes(kind)) {
      fail(`${where} has an unknown data-cta (${ctaKinds.join(' | ')})`);
      continue;
    }
    if (!ctaRanks.includes(rank)) {
      fail(`${where} has an unknown data-rank (${ctaRanks.join(' | ')})`);
      continue;
    }
    if (!targets[kind](node.attrs.href)) {
      fail(`${where} points at ${node.attrs.href}`);
    }
    // A beta is never the main action: TestFlight and the Android beta stay
    // below the two released ways in.
    if (rank === 'primary' && (kind === 'testflight' || kind === 'android')) {
      fail(`${where} promotes a beta route as a primary action`);
    }
  }

  const bars = findAll(document.root, (node) => 'data-bar' in node.attrs);
  if (bars.length !== 1) {
    fail(`${file} has ${bars.length} [data-bar] elements instead of 1`);
    return;
  }
  // The bar action and the menu action; both lead to the ways in.
  const gets = findAll(bars[0], isCta('get', 'primary'));
  if (
    gets.length !== 2 ||
    gets.some((node) => node.attrs.href !== `${homePath}#install`)
  ) {
    fail(
      `${file}: [data-bar] must hold exactly two data-cta="get" data-rank="primary" links to ${homePath}#install, found ${gets
        .map((node) => node.attrs.href)
        .join(', ')}`,
    );
  }
}

function ldNodes(value) {
  if (Array.isArray(value)) return value.flatMap(ldNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(ldNodes)];
}
const hasType = (node, type) => [node['@type']].flat().includes(type);

/** Every JSON-LD block on a page parses; returns all typed nodes in it. */
const structuredDataChecked = new Set();
function structuredData(file, document) {
  structuredDataChecked.add(file);
  const nodes = [];
  for (const block of findAll(
    document.root,
    (node) =>
      node.tag === 'script' && node.attrs.type === 'application/ld+json',
  )) {
    try {
      nodes.push(...ldNodes(JSON.parse(innerHtml(document, block))));
    } catch (error) {
      fail(`${file}: a JSON-LD block does not parse (${error.message})`);
    }
  }
  return nodes;
}

const marketingPages = [
  ['index.html', 'en', 'https://discvault.eu/', '/'],
  ...locales.map((locale) => [
    `${locale}/index.html`,
    locale,
    `https://discvault.eu/${locale}/`,
    `/${locale}/`,
  ]),
];
for (const [file, locale, canonical, homePath] of marketingPages) {
  const html = await requireFile(file);
  const checks = [
    `<html lang="${locale}"`,
    `rel="canonical" href="${canonical}"`,
    appStore,
    testflight,
    discord,
    docs,
    'hreflang="x-default"',
    'application/ld+json',
  ];
  for (const check of checks) {
    if (!html.includes(check)) {
      throw new Error(`${file} is missing ${check}`);
    }
  }

  const document = parseHtml(html);
  const scope = {};
  for (const id of anchors) {
    const matches = byId(document, id);
    if (matches.length !== 1) {
      fail(`${file} has ${matches.length} elements with id="${id}", needs 1`);
    }
    scope[id] = matches[0];
  }
  const within = (id, predicate) =>
    scope[id] ? findAll(scope[id], predicate) : [];
  const count = (id, kind, rank) => within(id, isCta(kind, rank)).length;

  // The Legacy page links to #migration; that block sends people on to it.
  if (
    !within(
      'migration',
      (node) => node.tag === 'a' && node.attrs.href === legacyPath,
    ).length
  ) {
    fail(`${file}: #migration has no link to ${legacyPath}`);
  }

  checkCtaLinks(file, document, homePath);

  // The hero and the closing call carry both main actions, once each.
  for (const id of ['discvault26', 'community']) {
    for (const [kind, href] of [
      ['app-store', appStore],
      ['self-hosted', docs],
    ]) {
      const links = within(id, isCta(kind, 'primary'));
      if (links.length !== 1 || links[0].attrs.href !== href) {
        fail(
          `${file}: #${id} must hold exactly one data-cta="${kind}" data-rank="primary" link to ${href}, found ${links.length}`,
        );
      }
    }
  }
  // The ways in: both main actions, TestFlight as a text link, Android below.
  if (!count('install', 'app-store', 'primary')) {
    fail(`${file}: #install has no primary app-store link`);
  }
  if (!count('install', 'self-hosted', 'primary')) {
    fail(`${file}: #install has no primary self-hosted link`);
  }
  if (!count('install', 'testflight', 'text')) {
    fail(`${file}: #install has no testflight link of rank text`);
  }
  if (!count('android', 'android')) {
    fail(`${file}: #android has no android link`);
  }

  /**
   * Structured data. 2.0 asserted only that the string
   * `application/ld+json` occurred. 3.0 parses every block, requires the
   * product node, and ties an FAQPage (not required yet: the questions
   * chapter is new in 3.0 and its structured data follows later) to the
   * questions actually on the page, so the two cannot drift apart.
   */
  const nodes = structuredData(file, document);
  if (!nodes.some((node) => hasType(node, 'SoftwareApplication'))) {
    fail(`${file} has no SoftwareApplication node in its JSON-LD`);
  }
  const faqItems = findAll(
    document.root,
    (node) => node.tag === 'details' && hasClass(node, 'faq-item'),
  ).length;
  for (const faqPage of nodes.filter((node) => hasType(node, 'FAQPage'))) {
    const questions = [faqPage.mainEntity ?? []]
      .flat()
      .filter((node) => hasType(node, 'Question')).length;
    if (questions !== faqItems) {
      fail(
        `${file}: FAQPage lists ${questions} questions, the page shows ${faqItems}`,
      );
    }
  }

  // The installation-count disclosure (ADR-0020) names the host a
  // self-hosted server reports to, in every language.
  if (
    scope.privacy &&
    !textOf(document, scope.privacy).includes(installationCountHost)
  ) {
    fail(`${file}: #privacy does not name ${installationCountHost}`);
  }

  if (html.includes(obsoleteDiscord)) {
    throw new Error(`${file} retains the obsolete Discord invite`);
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

// The legal shell shares the bar and the footer, so the same link rules hold.
for (const [file, homePath] of [
  ['privacy.html', '/'],
  ['terms.html', '/'],
  ['privacy-nl.html', '/nl/'],
  ['terms-nl.html', '/nl/'],
]) {
  const document = parseHtml(await requireFile(file));
  checkCtaLinks(file, document, homePath);
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

const outputFiles = await walk('dist');
if (!outputFiles.some((file) => file.endsWith('.avif'))) {
  throw new Error('No optimized AVIF showcase assets were emitted');
}
if (!outputFiles.some((file) => file.endsWith('.webp'))) {
  throw new Error('No optimized WebP showcase assets were emitted');
}

/**
 * Media and weight. 2.0 had no assertion here because it allowed no video
 * at all and kept fonts under 110 KB. ADR-0021 (decisions 5 and 6) allows
 * muted loops under conditions and replaces the budgets: a loop is never
 * fetched or started by markup (`preload="none"`, no `autoplay`; the media
 * script starts it while it is on screen), ships as WebM and MP4, and each
 * file stays at or under 1.5 MB; fonts stay at or under 220 KB together.
 * Sizes are decimal (1 KB = 1000 bytes), the stricter reading.
 */
const KB = 1000;
const MB = 1000 * KB;
const videoFileLimit = 1.5 * MB;
const videoTotalLimit = 16 * MB;
const fontTotalLimit = 220 * KB;

let videoElements = 0;
for (const file of outputFiles.filter((name) => name.endsWith('.html'))) {
  const name = path.relative('dist', file).replaceAll(path.sep, '/');
  const document = parseHtml(await readFile(file, 'utf8'));
  // The JSON-LD of every built page parses, not only the homepages'.
  if (!structuredDataChecked.has(name)) structuredData(name, document);
  for (const video of findAll(document.root, (node) => node.tag === 'video')) {
    videoElements += 1;
    const where = `${name}: <video> at offset ${video.start}`;
    for (const attribute of ['muted', 'playsinline', 'loop']) {
      if (!(attribute in video.attrs)) fail(`${where} lacks ${attribute}`);
    }
    if (video.attrs.preload !== 'none') {
      fail(`${where} must have preload="none"`);
    }
    for (const dimension of ['width', 'height']) {
      if (!(Number(video.attrs[dimension]) > 0)) {
        fail(`${where} lacks a numeric ${dimension}`);
      }
    }
    if ('autoplay' in video.attrs) fail(`${where} must not have autoplay`);
    const sourceTypes = findAll(
      video,
      (node) => node.tag === 'source' && node.attrs.src,
    ).map((node) => node.attrs.type);
    for (const type of ['video/webm', 'video/mp4']) {
      if (!sourceTypes.includes(type)) {
        fail(`${where} has no <source type="${type}">`);
      }
    }
  }
}

let videoBytes = 0;
const videoFiles = outputFiles.filter((file) => /\.(?:mp4|webm)$/i.test(file));
for (const file of videoFiles) {
  const { size } = await stat(file);
  videoBytes += size;
  if (size > videoFileLimit) {
    fail(
      `${file} is ${(size / MB).toFixed(2)} MB; a loop may be at most ${videoFileLimit / MB} MB`,
    );
  }
}
if (videoBytes > videoTotalLimit) {
  fail(
    `Video in dist/ totals ${(videoBytes / MB).toFixed(2)} MB; the limit is ${videoTotalLimit / MB} MB`,
  );
}

let fontBytes = 0;
for (const file of await readdir('public/fonts')) {
  if (file.endsWith('.woff2')) {
    fontBytes += (await stat(path.join('public/fonts', file))).size;
  }
}
if (fontBytes > fontTotalLimit) {
  fail(
    `public/fonts/*.woff2 totals ${(fontBytes / KB).toFixed(1)} KB; the limit is ${fontTotalLimit / KB} KB`,
  );
}

/**
 * Token ownership. New in 3.0: the house-style custom properties (`--dv-*`)
 * are generated from src/design/tokens.json into the three token files, and
 * no component or stylesheet may declare or override one. A chapter takes
 * its colours through the semantic layer (`--ground`, `--ink`, …) instead.
 * Design source: chrome-and-blue-web.md.
 */
const tokenFiles = new Set(
  ['tokens.css', 'tokens-dark-pin.css', 'tokens-dark-scope.css'].map((file) =>
    path.join('src', 'styles', file),
  ),
);
let scannedSources = 0;
for (const file of await walk('src')) {
  if (!/\.(?:css|astro)$/.test(file) || tokenFiles.has(file)) continue;
  scannedSources += 1;
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/--dv-[a-z0-9-]+\s*:/g)) {
      fail(
        `${file}:${index + 1} declares ${match[0].replace(/\s*:$/, '')} outside the generated token files`,
      );
    }
  });
}

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  console.error(`\n${failures.length} critical-route assertion(s) failed`);
  process.exit(1);
}

console.log(
  `Critical route smoke passed: ${critical.length} protected routes, ${marketingPages.length} locale routes (${anchors.length} anchors and the CTA contract each), FAQ fallback, SEO, responsive assets, ${videoElements} loop element(s) and ${videoFiles.length} video file(s) at ${(videoBytes / MB).toFixed(2)} MB, fonts at ${(fontBytes / KB).toFixed(1)} KB, ${scannedSources} sources free of --dv- declarations`,
);

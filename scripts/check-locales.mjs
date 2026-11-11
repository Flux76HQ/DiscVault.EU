import { access, readdir, readFile } from 'node:fs/promises';

const expectedLocales = [
  'cs',
  'da',
  'de',
  'el',
  'en',
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

const files = (await readdir('src/content/locales'))
  .filter((file) => file.endsWith('.json'))
  .sort();
const actualLocales = files.map((file) => file.replace(/\.json$/, ''));

if (JSON.stringify(actualLocales) !== JSON.stringify(expectedLocales)) {
  throw new Error(
    `Locale set differs.\nExpected: ${expectedLocales.join(', ')}\nActual: ${actualLocales.join(', ')}`,
  );
}

/**
 * Every leaf of a locale as `[path, value]`, the path dotted and array
 * indices written as keys (`privacy.body.1`). An empty array or object is a
 * leaf of its own, so it can be reported.
 *
 * 2.0 kept a list of "variable length" paths here (the voice lines and
 * `credits.final`, two or three segments per locale). The 3.0 model has no
 * such array: every array has the length it has in en.json, so the index is
 * simply part of the path and a missing or extra item is a parity failure.
 */
function leaves(value, prefix = '') {
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]);
    if (!entries.length) return [[prefix, value]];
    return entries.flatMap(([key, item]) =>
      leaves(item, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

function valueAtPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

const kindOf = (value) =>
  Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

const locales = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [
      file.replace(/\.json$/, ''),
      JSON.parse(await readFile(`src/content/locales/${file}`, 'utf8')),
    ]),
  ),
);

const reference = new Map(leaves(locales.en));

/**
 * The structure of the page lives in src/content/structure.ts: which
 * features, editions, table rows, shots, privacy tiles and questions exist.
 * A locale holds copy for exactly those ids.
 *
 * 2.0 asserted here the shape of the Pressed Light model: voice lines of two
 * or three segments (`leader`, `shelf`, `read`, `edition`, `vault`,
 * `formats`, `credits.final`), slates as arrays of facts without outer
 * whitespace, and `formats.routes` in the order self-hosted, ios, android.
 * Release 3.0 replaces that homepage with colour chapters; the model in
 * src/content/types.ts has none of those keys. Order is no longer a
 * property of a locale file at all: it comes from structure.ts, so a
 * translation cannot change it. Design source: Flux76HQ/App-Guidance,
 * projects/discvault/website/chrome-and-blue-web.md, and ADR-0021.
 */
const structureSource = await readFile('src/content/structure.ts', 'utf8');
function structureIds(name) {
  const body = structureSource.match(
    new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`),
  )?.[1];
  const ids = [...(body ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (!ids.length) {
    throw new Error(`src/content/structure.ts does not export ${name}`);
  }
  return ids;
}
const records = {
  'collect.blocks': structureIds('featureIds'),
  'editions.items': structureIds('editionIds'),
  'platforms.rows': structureIds('platformRowIds'),
  'selfHosted.shots': structureIds('shotIds'),
  'privacy.tiles': structureIds('privacyTileIds'),
  'faq.items': structureIds('faqIds'),
};
// Arrays the components index by position rather than loop over.
const fixedLengths = { 'privacy.body': 2 };

// Limits a search result can show without cutting the text off.
const seoLimits = { 'seo.title': 60, 'seo.description': 170 };

/**
 * Link targets live in src/config.ts, never in copy: a URL inside a string
 * cannot be checked by the link gate and would be translated along with the
 * sentence. The one exception is the host a self-hosted server reports to,
 * which the privacy chapter must name in every language (ADR-0020).
 * Besides the three URL forms, any discvault.eu host counts as a URL here,
 * which is what makes the exception an exception.
 */
const disclosurePath = 'privacy.body.1';
const disclosureHost = 'api.discvault.eu';
const urlPatterns = [
  ['http://', /http:\/\//i],
  ['https://', /https:\/\//i],
  ['www.', /\bwww\./i],
  ['a discvault.eu host', /(?:[a-z0-9-]+\.)*discvault\.eu/i],
];

/**
 * Copy that must be translated: a locale that keeps the English value here
 * has not been localised. 2.0 listed the Pressed Light leads and a few
 * navigation labels; this is the same mechanism over the 3.0 model.
 *
 * While scripts/.locales-pending exists the finding is a warning: 3.0 ships
 * its structure first, with English placeholders in the other nineteen
 * files. Delete the marker when the translations land and it is an error
 * again.
 */
const localizedCopyPaths = [
  'hero.title',
  'hero.lead',
  'collect.title',
  'scan.lead',
  'editions.lead',
  'platforms.lead',
  'selfHosted.lead',
  'privacy.lead',
  'privacy.body.0',
  'privacy.body.1',
  'plans.lead',
  'plans.pro',
  'faq.title',
  'cta.title',
  'cta.lead',
];
const pendingMarker = 'scripts/.locales-pending';
const translationsPending = await access(pendingMarker).then(
  () => true,
  () => false,
);

const errors = [];
const warnings = [];
const languageNames = new Map();

for (const [locale, content] of Object.entries(locales)) {
  const error = (message) => errors.push(`${locale}.json ${message}`);
  const own = new Map(leaves(content));

  if (content.locale !== locale) {
    error(`declares locale "${content.locale}"`);
  }
  if (typeof content.languageName === 'string' && content.languageName.trim()) {
    const taken = languageNames.get(content.languageName);
    if (taken) {
      error(`shares languageName "${content.languageName}" with ${taken}`);
    }
    languageNames.set(content.languageName, `${locale}.json`);
  }

  // Parity with en.json: the same paths, and the same kind of value at each.
  const missing = [...reference.keys()].filter((key) => !own.has(key));
  const extra = [...own.keys()].filter((key) => !reference.has(key));
  if (missing.length) error(`is missing: ${missing.join(', ')}`);
  if (extra.length) error(`has extra: ${extra.join(', ')}`);
  for (const [key, value] of own) {
    if (!reference.has(key)) continue;
    const expected = kindOf(reference.get(key));
    if (kindOf(value) !== expected) {
      error(`${key} is ${kindOf(value)}, en.json has ${expected}`);
    } else if (typeof value !== 'string') {
      // Copy only: an empty list or object, or a number, is not copy.
      error(`${key} must be a non-empty string, found ${kindOf(value)}`);
    } else if (!value.trim()) {
      error(`${key} is empty`);
    }
  }

  for (const [recordPath, ids] of Object.entries(records)) {
    const keys = Object.keys(valueAtPath(content, recordPath) ?? {});
    if ([...keys].sort().join() !== [...ids].sort().join()) {
      error(
        `${recordPath} must hold exactly the ids of structure.ts (${ids.join(', ')}), found ${keys.join(', ')}`,
      );
    }
  }
  for (const [arrayPath, length] of Object.entries(fixedLengths)) {
    const array = valueAtPath(content, arrayPath);
    if (!Array.isArray(array) || array.length !== length) {
      error(`${arrayPath} must be an array of ${length}`);
    }
  }

  for (const [seoPath, limit] of Object.entries(seoLimits)) {
    const length = [...String(valueAtPath(content, seoPath) ?? '')].length;
    if (length > limit) {
      error(`${seoPath} is ${length} characters; the limit is ${limit}`);
    }
  }

  for (const [key, value] of own) {
    if (typeof value !== 'string') continue;
    const text =
      key === disclosurePath ? value.replaceAll(disclosureHost, '') : value;
    for (const [label, pattern] of urlPatterns) {
      if (pattern.test(text)) {
        error(`${key} contains a URL (${label}); link targets live in config`);
      }
    }
    // No price anywhere: Pro has none yet, and a figure in one language
    // would be a claim in all of them (the owner's decision of 2026-11-11).
    if (/[€$£¥₩₺₴]|\b(?:EUR|USD|GBP)\b/.test(value)) {
      error(`${key} names a price or a currency; the site states none`);
    }
    // The product name stays as it is in every language.
    const english = reference.get(key);
    if (
      typeof english === 'string' &&
      english.includes('DiscVault') &&
      !value.includes('DiscVault')
    ) {
      error(`${key} must keep the name "DiscVault" untranslated`);
    }
  }
  if (!String(own.get(disclosurePath) ?? '').includes(disclosureHost)) {
    error(`${disclosurePath} must name ${disclosureHost}`);
  }

  if (locale !== 'en') {
    const untranslated = localizedCopyPaths.filter(
      (key) => valueAtPath(content, key) === valueAtPath(locales.en, key),
    );
    if (untranslated.length) {
      (translationsPending ? warnings : errors).push(
        `${locale}.json retains English localized copy: ${untranslated.join(', ')}`,
      );
    }
  }
}

for (const key of localizedCopyPaths) {
  if (typeof valueAtPath(locales.en, key) !== 'string') {
    errors.push(`localizedCopyPaths names ${key}, which en.json does not have`);
  }
}

if (warnings.length) {
  for (const warning of warnings) console.warn(`! ${warning}`);
  console.warn(
    `${warnings.length} locale(s) still hold English placeholder copy. This is a warning only while ${pendingMarker} exists.`,
  );
}
if (errors.length) {
  for (const message of errors) console.error(`✗ ${message}`);
  console.error(`\n${errors.length} locale assertion(s) failed`);
  process.exit(1);
}

console.log(
  `Locale parity passed: ${files.length} locales, ${reference.size} leaf values each${translationsPending ? ' (translations pending)' : ''}`,
);

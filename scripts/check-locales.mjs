import { readdir, readFile } from 'node:fs/promises';

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

// Voice lines may have two or three segments per locale; their length is
// checked separately, so the parity shape treats them as one leaf.
const variableLengthPaths = new Set([
  'leader.voice',
  'shelf.voice',
  'read.voice',
  'edition.voice',
  'vault.voice',
  'formats.voice',
  'credits.final',
]);

function shape(value, prefix = '') {
  if (variableLengthPaths.has(prefix)) {
    return [prefix];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => shape(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .flatMap((key) => shape(value[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

function findEmpty(value, prefix = '') {
  if (typeof value === 'string') {
    return value.trim() ? [] : [prefix];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findEmpty(item, `${prefix}[${index}]`),
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findEmpty(item, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

const locales = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [
      file.replace(/\.json$/, ''),
      JSON.parse(await readFile(`src/content/locales/${file}`, 'utf8')),
    ]),
  ),
);

const referenceShape = shape(locales.en);

// Keys that must be translated: a locale that keeps the English value here
// has not been localised.
const localizedCopyPaths = [
  'nav.library',
  'nav.scan',
  'nav.editions',
  'nav.install',
  'actions.appStore',
  'actions.android',
  'actions.privacy',
  'leader.lead',
  'shelf.lead',
  'read.lead',
  'edition.lead',
  'vault.lead',
  'formats.lead',
  'formats.roadmap',
  'footer.legacy',
  'footer.terms',
];

// Voice lines: two or three segments, the emphasised segment at index 1.
const voicePaths = [
  'leader.voice',
  'shelf.voice',
  'read.voice',
  'edition.voice',
  'vault.voice',
  'formats.voice',
  'credits.final',
];

// Slates are arrays of facts; the component joins them with a hair-spaced
// middle dot, so a fact never carries a separator of its own between words.
const slatePaths = [
  'leader.slate',
  'leader.note',
  'shelf.slate',
  'shelf.counter',
  'read.slate',
  'read.note',
  'edition.slate',
  'vault.slate',
  'formats.slate',
  'formats.migration',
];

function valueAtPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current[key], value);
}

for (const [locale, content] of Object.entries(locales)) {
  const localeShape = shape(content);
  const missing = referenceShape.filter((key) => !localeShape.includes(key));
  const extra = localeShape.filter((key) => !referenceShape.includes(key));
  const empty = findEmpty(content);

  if (content.locale !== locale) {
    throw new Error(`${locale}.json declares locale "${content.locale}"`);
  }
  for (const path of voicePaths) {
    const segments = valueAtPath(content, path);
    if (
      !Array.isArray(segments) ||
      segments.length < 2 ||
      segments.length > 3 ||
      !segments[1].trim()
    ) {
      throw new Error(
        `${locale}.json ${path} must be two or three segments with the emphasised segment at index 1`,
      );
    }
  }
  for (const path of slatePaths) {
    const facts = valueAtPath(content, path);
    if (!Array.isArray(facts) || facts.length === 0) {
      throw new Error(`${locale}.json ${path} must be a non-empty array`);
    }
    for (const fact of facts) {
      if (/^\s|\s$/.test(fact)) {
        throw new Error(
          `${locale}.json ${path} fact "${fact}" has outer whitespace`,
        );
      }
    }
  }
  const routeIds = content.formats.routes.map((route) => route.id);
  if (JSON.stringify(routeIds) !== '["self-hosted","ios","android"]') {
    throw new Error(
      `${locale}.json formats.routes must be self-hosted, ios, android in that order`,
    );
  }
  if (locale !== 'en') {
    const untranslated = localizedCopyPaths.filter(
      (key) => valueAtPath(content, key) === valueAtPath(locales.en, key),
    );
    if (untranslated.length) {
      throw new Error(
        `${locale}.json retains English localized copy: ${untranslated.join(', ')}`,
      );
    }
  }
  if (missing.length || extra.length || empty.length) {
    throw new Error(
      `${locale} parity failed\nMissing: ${missing.join(', ')}\nExtra: ${extra.join(', ')}\nEmpty: ${empty.join(', ')}`,
    );
  }
}

console.log(
  `Locale parity passed: ${files.length} locales, ${referenceShape.length} leaf values each`,
);

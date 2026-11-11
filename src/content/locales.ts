import type { MarketingContent } from './types';

export const localeCodes = [
  'en',
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
] as const;

export type Locale = (typeof localeCodes)[number];

const localeModules = import.meta.glob<MarketingContent>('./locales/*.json', {
  eager: true,
  import: 'default',
});

export const contentByLocale = Object.fromEntries(
  Object.entries(localeModules).map(([path, content]) => [
    path.match(/\/([^/]+)\.json$/)?.[1],
    content,
  ]),
) as Record<Locale, MarketingContent>;

export function localePath(locale: Locale): string {
  return locale === 'en' ? '/' : `/${locale}/`;
}

/** Open Graph wants language_TERRITORY; the site's codes are bare languages. */
export const ogLocale: Record<Locale, string> = {
  en: 'en_GB',
  cs: 'cs_CZ',
  da: 'da_DK',
  de: 'de_DE',
  el: 'el_GR',
  es: 'es_ES',
  fi: 'fi_FI',
  fr: 'fr_FR',
  hu: 'hu_HU',
  it: 'it_IT',
  ja: 'ja_JP',
  ko: 'ko_KR',
  nl: 'nl_NL',
  no: 'nb_NO',
  pl: 'pl_PL',
  pt: 'pt_PT',
  sv: 'sv_SE',
  tr: 'tr_TR',
  uk: 'uk_UA',
  zh: 'zh_CN',
};

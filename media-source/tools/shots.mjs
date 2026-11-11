// Marketing screenshots of the local DiscVault Core demo instance.
//
//   node shots.mjs                 all shots
//   node shots.mjs detail mobile   only shots whose name contains one of the words
//
// Environment (all optional):
//   DV_BASE_URL        default http://127.0.0.1:5055
//   DV_OWNER_USERNAME / DV_OWNER_PASSWORD   exported by run.sh (from .demo-env)
//   DV_MANIFEST        default ./manifest.json (used to pick the featured / detail films)
//   DV_SHOTS_DIR       default ./shots
//   DV_SIDEBAR         expanded (default) | collapsed
//   DV_FEATURED, DV_DETAIL, DV_STEELBOOK, DV_BOXSET   titles to use instead of the automatic picks
//   DV_SCAN_BARCODE    barcode typed into Add > Single search (default: first manifest "catalog" disc)
//
// Dark theme, "bluray" accent and English are forced three ways: the owner's stored
// preferences (seed_demo.py), the browser context (locale en-US, dark colour scheme) and the
// app's own localStorage keys, set before any page script runs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // the globally installed Playwright (NODE_PATH)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.DV_BASE_URL || 'http://127.0.0.1:5055').replace(/\/$/, '');
const USER = process.env.DV_OWNER_USERNAME || 'alex';
const PASS = process.env.DV_OWNER_PASSWORD;
if (!PASS) throw new Error('DV_OWNER_PASSWORD is not set: run this through run.sh');
const OUT = process.env.DV_SHOTS_DIR || path.join(HERE, 'shots');
const SIDEBAR = (process.env.DV_SIDEBAR || 'expanded').toLowerCase();
const manifest = JSON.parse(fs.readFileSync(process.env.DV_MANIFEST || path.join(HERE, 'manifest.json'), 'utf8'));
const only = process.argv.slice(2).map((s) => s.toLowerCase());
fs.mkdirSync(OUT, { recursive: true });

const owned = manifest.films.filter((f) => !f.wishlist);
const pick = (envName, test) => process.env[envName] || (owned.find(test) || owned[0]).title;
const FEATURED = pick('DV_FEATURED', (f) => f.backdrop && !f.steelbook && !f.box_set);
const DETAIL = pick('DV_DETAIL', (f) => f.backdrop && !f.steelbook && !f.box_set && f.watched && f.title !== FEATURED);
const STEELBOOK = pick('DV_STEELBOOK', (f) => f.steelbook);
const SCAN = process.env.DV_SCAN_BARCODE
  || ((manifest.catalog || [])[0] || manifest.films.find((f) => f.wishlist) || {}).barcode || '';
const BOXSET = process.env.DV_BOXSET || (owned.find((f) => f.box_set && f.backdrop) || owned.find((f) => f.box_set) || {}).box_set?.name;

// Runs before every page script. Nothing here changes what the app stores on the server.
const initScript = ({ sidebar }) => {
  try {
    const set = (k, v) => localStorage.setItem(k, v);
    set('dv_next_support_prompt_seen', '1');   // no "Enjoying DiscVault?" dialog
    set('dv_next_theme', 'dark');
    set('dv_next_accent', 'bluray');
    set('dv_next_locale', 'en');
    set('dv_next_locale_explicit', '1');
    set('dv_lang', 'en');
    set('dv_next_debug_mode', 'false');
    set('dv_next_sidebar_collapsed', sidebar === 'collapsed' ? '1' : '0');
    if (!sessionStorage.getItem('dv_shots_reset')) {
      // one clean slate per browser context: no leftover filters / tabs / view modes
      ['dv_next_collection_formats', 'dv_next_collection_format', 'dv_next_collection_type',
        'dv_next_collection_genre', 'dv_next_collection_location', 'dv_next_collection_item_filter',
        'dv_next_hide_watchlist', 'dv_next_hide_watched', 'dv_next_active_smart_filter',
        'dv_next_advanced_search_open', 'dv_next_library_view_mode', 'dv_next_lists_view_mode',
        'dv_next_profile_tab', 'dv_next_admin_users_tab', 'dv_next_admin_roles_tab',
        'dv_next_admin_plugin_tab'].forEach((k) => localStorage.removeItem(k));
      sessionStorage.setItem('dv_shots_reset', '1');
    }
    // Opening a detail page normally queues a metadata refresh job ("Refreshing metadata...").
    // The demo is offline and runs no worker, so report every lazy refresh as "just done".
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (String(key).startsWith('dv_lazy_refresh:')) return String(Date.now());
      return getItem.call(this, key);
    };
  } catch (error) { /* storage unavailable: the app still works */ }
};

const SHOT_CSS = `
  html { scrollbar-width: none !important; }
  *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
  .sidebar-footer { display: none !important; }            /* "App version / Build <sha>" box */
  #appAdminDebugButton { display: none !important; }       /* "Debug" toggle in the Admin header */
  #supportPromptBackdrop, .toast, .toast-stack, .toast-container { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

async function settle(page, extraMs = 350) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.addStyleTag({ content: SHOT_CSS }).catch(() => {});
  await page.evaluate(async () => {
    const images = [...document.images].filter((img) => img.getBoundingClientRect().width > 0 && img.getAttribute('src'));
    await Promise.all(images.map((img) => (img.complete ? null : new Promise((res) => {
      img.addEventListener('load', res, { once: true });
      img.addEventListener('error', res, { once: true });
      setTimeout(res, 8000);
    }))));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(extraMs);
  await page.evaluate(() => {
    // no "selected" tile ring, no keyboard focus ring
    document.querySelectorAll('.preview-poster.selected, [data-preview-container].selected, .selected[data-list-movie]')
      .forEach((node) => node.classList.remove('selected'));
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

async function main() {
  const browser = await chromium.launch();
  const problems = [];

  async function newContext(viewport, deviceScaleFactor, mobile) {
    const context = await browser.newContext({
      viewport, deviceScaleFactor, locale: 'en-US', colorScheme: 'dark', timezoneId: 'Europe/Amsterdam',
      ...(mobile ? { isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' } : {}),
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    await context.addInitScript(initScript, { sidebar: SIDEBAR });
    const login = await context.request.post(`${BASE}/api/next/auth/legacy/login`, {
      data: { username: USER, password: PASS }, headers: { Origin: BASE },
    });
    const body = await login.json().catch(() => ({}));
    if (!login.ok() || body.stage !== 'complete') throw new Error(`login failed: ${login.status()} ${JSON.stringify(body).slice(0, 200)}`);
    // belt and braces: the stored preferences decide theme/accent/locale on first paint
    await context.request.patch(`${BASE}/api/next/preferences`, { data: { theme: 'dark', accent: 'bluray' }, headers: { Origin: BASE } });
    await context.request.post(`${BASE}/api/next/preferences/locale`, { data: { locale: 'en' }, headers: { Origin: BASE } });
    return context;
  }

  async function lookups(context) {
    const get = async (p) => (await context.request.get(BASE + p)).json();
    const movies = (await get('/api/next/movies?limit=500')).items || [];
    const containers = (await get('/api/next/containers')).items || [];
    const locations = (await get('/api/next/locations')).items || [];
    return {
      movie: (title) => (movies.find((m) => m.title === title) || {}).id,
      barcode: (title) => (movies.find((m) => m.title === title) || {}).barcode,
      container: (title) => (containers.find((c) => c.title === title) || {}).id,
      location: (name) => (locations.find((l) => l.name === name) || locations.find((l) => (l.movie_count || 0) > 0) || {}),
    };
  }

  function watch(page, name) {
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: console error: ${m.text().slice(0, 160)}`); });
    page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== new URL(BASE).hostname) problems.push(`${name}: external request ${r.url().slice(0, 120)}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`${name}: HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`); });
  }

  async function shot(context, name, url, steps = async () => {}, opts = {}) {
    if (only.length && !only.some((word) => name.toLowerCase().includes(word))) return;
    const page = await context.newPage();
    watch(page, name);
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle' });
      await settle(page, 600);
      await steps(page);
      await settle(page);
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file, fullPage: !!opts.fullPage, animations: 'disabled' });
      const lang = await page.evaluate(() => `${document.documentElement.lang}|${document.documentElement.getAttribute('data-theme')}`);
      console.log(`ok  ${name}.png  (${lang})`);
    } catch (error) {
      problems.push(`${name}: ${String(error.message || error).split('\n')[0]}`);
      console.log(`ERR ${name}: ${String(error.message || error).split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }

  const click = async (page, selector) => { await page.click(selector, { timeout: 8000 }); await page.waitForTimeout(450); };
  const feature = (id) => async (page) => {
    // Put a film with a backdrop in the "Featured" hero (the app features a film on tile click / Shuffle).
    await page.evaluate((movieId) => { if (typeof selectMovie === 'function') selectMovie(movieId); }, id);
    await page.waitForTimeout(300);
  };

  // ------------------------------------------------------------------ desktop
  const desktop = await newContext({ width: 1600, height: 1000 }, 2, false);
  const ids = await lookups(desktop);
  const featuredId = ids.movie(FEATURED);
  const detailId = ids.movie(DETAIL);
  const steelId = ids.movie(STEELBOOK);
  const boxId = BOXSET ? ids.container(BOXSET) : null;
  console.log(`featured="${FEATURED}" detail="${DETAIL}" steelbook="${STEELBOOK}" boxset="${BOXSET}" sidebar=${SIDEBAR}`);

  const setPref = (data) => desktop.request.patch(`${BASE}/api/next/preferences`, { data, headers: { Origin: BASE } });
  await shot(desktop, '01-library-posters', '/', feature(featuredId));
  await shot(desktop, '02b-library-list-with-hero', '/', async (page) => {
    await click(page, '[data-library-view-mode="list"]');
    await feature(featuredId)(page);
  });
  // "Featured hero" is a user preference (Profile > Preferences > Library). Off for the list and
  // filter shots so the toolbar and the rows share one frame; switched back on right after.
  await setPref({ show_featured_hero: false });
  await shot(desktop, '01b-library-wall', '/', async () => {});
  await shot(desktop, '02-library-list', '/', async (page) => {
    await click(page, '[data-library-view-mode="list"]');
  });
  await shot(desktop, '03-library-filter-4k', '/', async (page) => {
    await click(page, '#collectionFilterTrigger');
    await page.locator('input[data-format-switch="4K UHD"]').check({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    // still open? toggle it shut with its own trigger (never click the page: tiles open on click)
    if (await page.locator('input[data-format-switch="4K UHD"]').isVisible().catch(() => false)) {
      await click(page, '#collectionFilterTrigger');
    }
  });
  await setPref({ show_featured_hero: true });
  await shot(desktop, '03b-library-filter-4k-menu', '/', async (page) => {
    await click(page, '#collectionFilterTrigger');
    await page.locator('input[data-format-switch="4K UHD"]').check({ force: true });
    await page.waitForTimeout(500);
    const first4k = await page.evaluate(() => document.querySelector('[data-preview-movie]')?.dataset.previewMovie || '');
    if (first4k) await page.evaluate((id) => { if (typeof selectMovie === 'function') selectMovie(id); }, first4k);
  });
  // The format filter is stored in localStorage; clear it for the shots that follow.
  {
    const page = await desktop.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.removeItem('dv_next_collection_formats'); localStorage.removeItem('dv_next_library_view_mode'); });
    await page.close();
  }

  await shot(desktop, '04-film-detail', `/movies/${detailId}`);
  await shot(desktop, '04b-film-detail-full', `/movies/${detailId}`, async () => {}, { fullPage: true });
  if (boxId) {
    await shot(desktop, '05-boxset-detail', `/containers/${boxId}`);
  } else problems.push('05-boxset-detail: no box set found');
  await shot(desktop, '06-steelbook-detail', `/movies/${steelId}`);
  await shot(desktop, '06b-steelbook-detail-collectors', `/movies/${steelId}`, async (page) => {
    await click(page, '#movieDetailCollectorsTab');
    await page.evaluate(() => document.getElementById('movieDetailCollectorsTab')?.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -24));
  });
  await shot(desktop, '06c-steelbook-detail-technical', `/movies/${steelId}`, async (page) => {
    await click(page, '#movieDetailTechnicalTab');
    await page.evaluate(() => document.getElementById('movieDetailTechnicalTab')?.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -24));
  });

  // Add / scan: a barcode from the manifest's offline catalogue mirror resolves locally,
  // with its poster, without any provider call.
  const scan = (clean) => async (page) => {
    await click(page, '#importMethodTabSingle');
    await page.fill('#importBarcodeInput', SCAN);
    await click(page, '#importBarcodePreviewButton');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForSelector('#importBarcodeResults img', { timeout: 15000 });
    if (clean) {
      // The amber "Add a free TMDb API key" notice is hidden in this variant only.
      await page.evaluate(() => {
        const results = document.getElementById('importBarcodeResults');
        [...document.querySelectorAll('#importMethodPanelSingle *, #importBarcodeResults *')]
          .filter((n) => n.children.length && /TMDb API key/i.test(n.textContent || '') && !n.contains(results)
            && !n.querySelector('#importBarcodeForm') && n.getBoundingClientRect().height < 220)
          .forEach((n) => { n.style.display = 'none'; });
      });
    }
    // frame the result cards (and the "Add title" button under them) at the bottom of the viewport
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  };
  await shot(desktop, '07-add-scan-result', '/import', scan(false));
  await shot(desktop, '07a-add-scan-result-clean', '/import', scan(true));
  await shot(desktop, '07b-add-scan-start', '/import');

  await shot(desktop, '08-watchlist-posters', '/lists');
  await shot(desktop, '09-watch-history', '/lists', async (page) => { await click(page, '[data-lists-tab="watched"]'); });
  await shot(desktop, '09b-watch-history-list', '/lists', async (page) => {
    await click(page, '[data-lists-tab="watched"]');
    await click(page, '[data-lists-view-mode="list"]');
  });
  {
    const page = await desktop.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.removeItem('dv_next_lists_view_mode'));
    await page.close();
  }
  await shot(desktop, '10-wishlist-price-alerts', '/lists', async (page) => { await click(page, '[data-lists-tab="wishlist"]'); });

  await shot(desktop, '11-locations', '/profile', async (page) => {
    await click(page, '#profileTabStructure');
    await click(page, '[data-structure-tab="locations"]');
  });
  const shelf = ids.location('Shelf A');
  if (shelf.public_id) await shot(desktop, '11b-location-detail', `/locations/${shelf.public_id}`);
  await shot(desktop, '11c-structure-box-sets', '/profile', async (page) => { await click(page, '#profileTabStructure'); });
  await shot(desktop, '12-statistics', '/statistics');
  await shot(desktop, '12b-statistics-full', '/statistics', async () => {}, { fullPage: true });

  await shot(desktop, '13-admin-users', '/admin', async (page) => {
    await click(page, '#appAdminTabUsers');
    await click(page, '#appAdminUsersTabUsers');
  });
  await shot(desktop, '14-admin-roles', '/admin', async (page) => {
    await click(page, '#appAdminTabRoles');
    await click(page, '#appAdminRolesTabRoles');
  });
  await shot(desktop, '14b-admin-roles-overview', '/admin', async (page) => {
    await click(page, '#appAdminTabRoles');
    await click(page, '#appAdminRolesTabOverview');
  });
  await shot(desktop, '15-admin-plugins', '/admin', async (page) => {
    await click(page, '#appAdminTabPlugins');
    await click(page, '#appAdminPluginTabInstalled');
  });
  await shot(desktop, '15b-admin-plugins-overview', '/admin', async (page) => {
    await click(page, '#appAdminTabPlugins');
    await click(page, '#appAdminPluginTabOverview');
  });
  await shot(desktop, '16-preferences-appearance', '/profile', async (page) => {
    await click(page, '#profileTabPreferences');
    await click(page, '#preferenceTabAppearance');
  });
  await shot(desktop, '17-import-sources', '/import', async (page) => { await click(page, '#importTabSources'); });
  await shot(desktop, '17b-import-csv', '/import', async (page) => { await click(page, '#importMethodTabCsv'); });
  await shot(desktop, '17c-import-boxset-builder', '/import', async (page) => { await click(page, '#importMethodTabBoxset'); });
  // Standalone legacy-data migration wizard. In 26.11.0 this page stops at "pluginDisplayName is
  // not defined" (the helper is only defined in the main app shell) - captured as evidence, not for use.
  await shot(desktop, '18-migration-wizard-BROKEN', '/api/next/migration');
  await desktop.close();

  // ------------------------------------------------------------------- mobile
  const mobile = await newContext({ width: 390, height: 844 }, 3, true);
  await shot(mobile, 'm01-library', '/', feature(featuredId));
  await shot(mobile, 'm01b-library-grid', '/', async (page) => {
    await feature(featuredId)(page);
    await page.evaluate(() => document.getElementById('posterRail')?.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -90));
  });
  await shot(mobile, 'm02-film-detail', `/movies/${detailId}`);
  await mobile.close();

  await browser.close();
  const unique = [...new Set(problems)];
  if (unique.length) {
    console.log(`\n${unique.length} thing(s) to look at:`);
    unique.forEach((line) => console.log('  - ' + line));
  } else {
    console.log('\nno console errors, failed requests or external requests');
  }
  console.log(`shots in ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });

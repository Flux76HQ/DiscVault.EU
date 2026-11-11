// Frame-by-frame capture of the real DiscVault UI for the site's loops.
// usage: node film.mjs <name> <outDir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:5055';
const [name, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const initScript = () => {
  try {
    const set = (k, v) => localStorage.setItem(k, v);
    set('dv_next_support_prompt_seen', '1'); set('dv_next_theme', 'dark'); set('dv_next_accent', 'bluray');
    set('dv_next_locale', 'en'); set('dv_next_locale_explicit', '1'); set('dv_lang', 'en');
    set('dv_next_debug_mode', 'false'); set('dv_next_sidebar_collapsed', '0');
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) { if (String(key).startsWith('dv_lazy_refresh:')) return String(Date.now()); return getItem.call(this, key); };
  } catch (e) {}
};
const CSS = `html{scrollbar-width:none!important;scroll-behavior:auto!important}*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}
.sidebar-footer,#appAdminDebugButton,#supportPromptBackdrop,.toast,.toast-stack,.toast-container{display:none!important}*,*::before,*::after{caret-color:transparent!important}`;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const browser = await chromium.launch();
const mobile = name.startsWith('m-');
const context = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, deviceScaleFactor: mobile ? 2 : 1,
  locale: 'en-US', colorScheme: 'dark', timezoneId: 'Europe/Amsterdam',
  ...(mobile ? { isMobile: true, hasTouch: true } : {}),
});
await context.addInitScript(initScript);
const login = await context.request.post(`${BASE}/api/next/auth/legacy/login`, { data: { username: 'alex', password: process.env.DV_OWNER_PASSWORD }, headers: { Origin: BASE } });
if (!login.ok()) throw new Error('login failed ' + login.status());
const pref = (data) => context.request.patch(`${BASE}/api/next/preferences`, { data, headers: { Origin: BASE } });
await pref({ theme: 'dark', accent: 'bluray', show_featured_hero: false });
const page = await context.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: CSS });
await page.waitForTimeout(800);
// find what scrolls
const scroller = await page.evaluateHandle(() => {
  const cands = [document.scrollingElement, ...document.querySelectorAll('main, .content, .app-main, [class*=content], [class*=main]')];
  let best = document.scrollingElement, bestRange = 0;
  for (const el of cands) { if (!el) continue; const r = el.scrollHeight - el.clientHeight; const o = getComputedStyle(el).overflowY; if (r > bestRange && (el === document.scrollingElement || /auto|scroll/.test(o))) { best = el; bestRange = r; } }
  return best;
});
const range = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
console.log('scroll range', range);
// warm every lazy image
for (let y = 0; y <= range; y += 400) { await scroller.evaluate((el, y) => { el.scrollTop = y; }, y); await page.waitForTimeout(120); }
await scroller.evaluate((el) => { el.scrollTop = 0; });
await page.waitForLoadState('networkidle'); await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected')); document.activeElement?.blur?.(); });
await page.mouse.move(0, 0);
const frames = 192, travel = Math.min(range, mobile ? 1500 : 1150);
for (let i = 0; i < frames; i += 1) {
  const t = i / frames; const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
  const y = Math.round(travel * ease(tri));
  await scroller.evaluate((el, y) => { el.scrollTop = y; }, y);
  await page.waitForTimeout(30);
  await page.screenshot({ path: `${OUT}/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 });
}
await pref({ show_featured_hero: true });
await browser.close();
console.log('frames', frames);

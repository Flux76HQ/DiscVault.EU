/**
 * Screenshot matrix for review: every available engine × five viewports ×
 * the top of each colour chapter, written to .experience/ (git-ignored).
 * Not a gate; a person looks at the output.
 * Usage: node scripts/screenshot-matrix.mjs [route ...]   (default: /)
 *
 * Set DV_CHROMIUM_PATH to use a Chromium other than the one Playwright
 * installs. Firefox and WebKit are used when Playwright has them.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const host = '127.0.0.1';
const port = 4178;
const base = `http://${host}:${port}`;
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/'];
const viewports = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 568],
];
// 2.0 listed the seven reels of the Pressed Light homepage (hero, shelf,
// read, edition, vault, formats, credits). Release 3.0 replaces them with
// colour chapters (App-Guidance, chrome-and-blue-web.md; ADR-0021), so the
// targets are the chapters, in page order.
const targets = [
  ['hero', '#discvault26'],
  ['collect', '#product'],
  ['scan', '#scan'],
  ['editions', '#editions'],
  ['self-hosted', '#self-hosted'],
  ['platforms', '#install'],
  ['privacy', '#privacy'],
  ['plans', '#plans'],
  ['faq', '#faq'],
  ['cta', '#community'],
  ['footer', '#footer'],
];
// 2.0 waited 5.6 s for the entrance and the first idle pass. 3.0 has
// neither; this only lets the fonts and the first images settle.
const settleMs = 1200;

const server = spawn(
  process.execPath,
  ['scripts/serve-dist.mjs', '--host', host, '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
await new Promise((resolve, reject) => {
  server.stdout.on('data', resolve);
  server.on('exit', (code) => reject(new Error(`preview exited ${code}`)));
});

const outDir = '.experience';
await mkdir(outDir, { recursive: true });
const chromiumPath = process.env.DV_CHROMIUM_PATH || undefined;
const engines = [
  ['chromium', chromium, chromiumPath ? { executablePath: chromiumPath } : {}],
  ['firefox', firefox, {}],
  ['webkit', webkit, {}],
];
try {
  for (const [name, type, launchOptions] of engines) {
    let browser;
    try {
      browser = await type.launch(launchOptions);
    } catch (error) {
      console.log(
        `${name}: not available here (${String(error.message).split('\n')[0]})`,
      );
      continue;
    }
    for (const route of routes) {
      const slug = route === '/' ? 'home' : route.replaceAll('/', '') || 'home';
      for (const [width, height] of viewports) {
        const context = await browser.newContext({
          viewport: { width, height },
        });
        const page = await context.newPage();
        await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.evaluate(() => {
          document.documentElement.style.scrollBehavior = 'auto';
        });
        await page.waitForTimeout(settleMs);
        for (const [label, selector] of targets) {
          const element = page.locator(selector);
          if (!(await element.count())) continue;
          // The chapter's top edge at the top of the viewport, so each
          // shot shows a chapter from its start, bar included.
          await element.evaluate((node) =>
            scrollTo(0, node.getBoundingClientRect().top + scrollY),
          );
          // Decode what is on screen. A lazy image elsewhere on the page (or
          // in a record the scan demo is not showing) never loads, so its
          // decode() would never settle: only the viewport is waited for,
          // and not for longer than two seconds.
          await page.evaluate(() =>
            Promise.race([
              Promise.all(
                [...document.images]
                  .filter((image) => {
                    const rect = image.getBoundingClientRect();
                    return (
                      rect.width > 0 &&
                      rect.bottom > 0 &&
                      rect.top < innerHeight
                    );
                  })
                  .map((image) => image.decode().catch(() => {})),
              ),
              new Promise((resolve) => setTimeout(resolve, 2000)),
            ]),
          );
          await page.waitForTimeout(600);
          await page.screenshot({
            path: path.join(outDir, `${name}-${slug}-${width}-${label}.png`),
          });
        }
        await context.close();
      }
    }
    await browser.close();
    console.log(`${name}: done`);
  }
} finally {
  server.kill();
}

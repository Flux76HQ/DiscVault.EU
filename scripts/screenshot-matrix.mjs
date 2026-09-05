/**
 * Screenshot matrix for review (build plan prompt 12): every available
 * engine × five viewports × the hero and each reel's top, written to
 * .experience/ (git-ignored). Not a gate; a person looks at the output.
 * Usage: node scripts/screenshot-matrix.mjs [route ...]   (default: /)
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
const targets = [
  ['hero', '#discvault26'],
  ['shelf', '#product'],
  ['read', '#scan'],
  ['edition', '#editions'],
  ['vault', '#privacy'],
  ['formats', '#install'],
  ['credits', '#credits'],
];

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
const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
try {
  for (const [name, type] of engines) {
    let browser;
    try {
      browser = await type.launch();
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
        // After the entrance and the first idle pass (which rests at 4.8 s).
        await page.waitForTimeout(5600);
        for (const [label, selector] of targets) {
          const element = page.locator(selector);
          if (!(await element.count())) continue;
          await element.scrollIntoViewIfNeeded();
          await page.evaluate(() =>
            Promise.all(
              [...document.images].map((image) =>
                image.decode().catch(() => {}),
              ),
            ),
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

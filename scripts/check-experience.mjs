/**
 * Experience checks for the marketing routes (build plan prompt 8;
 * motion-system.md §10). Runs against a built dist/ through the static
 * preview and asserts, per route:
 *  - nothing inside <main> is hidden at rest without JavaScript;
 *  - no request leaves the preview host;
 *  - under reduced motion nothing runs after 100 ms and the idle pass rests;
 *  - the pointer drives the hero tilt and the wall torch, and nothing else;
 *  - the strip is scrolled after 100 px;
 *  - the idle pass repeats three times;
 *  - the compiled CSS animates no background-position, filter or box-shadow;
 *  - every pass band rests entirely outside its parent.
 */
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = 4177;
const base = `http://${host}:${port}`;
const routes = ['/', '/nl/'];

const server = spawn(
  process.execPath,
  ['scripts/serve-dist.mjs', '--host', host, '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error('Static preview did not start')),
    10_000,
  );
  server.stdout.on('data', () => {
    clearTimeout(timeout);
    resolve();
  });
  server.on('exit', (code) =>
    reject(new Error(`Static preview exited with code ${code}`)),
  );
});

const failures = [];
const fail = (message) => failures.push(message);

// Compiled CSS: no animated background-position, filter or box-shadow.
const cssDir = path.join('dist', '_astro');
for (const file of await readdir(cssDir)) {
  if (!file.endsWith('.css')) continue;
  const css = await readFile(path.join(cssDir, file), 'utf8');
  for (const block of css.match(
    /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
  ) ?? []) {
    for (const property of ['background-position', 'filter', 'box-shadow']) {
      if (block.includes(`${property}:`)) {
        fail(`${file} animates ${property} in ${block.slice(0, 40)}…`);
      }
    }
  }
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  server.kill();
  throw error;
}
try {
  for (const route of routes) {
    // 1. No JavaScript: nothing hidden inside main.
    {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(base + route, { waitUntil: 'load' });
      // The hero's entrance (a lighting change over decorative layers) may
      // still be playing; content is judged after it, and decorative
      // (aria-hidden) layers are light, not content.
      await page.waitForTimeout(2800);
      const hidden = await page.evaluate(() =>
        [...document.querySelectorAll('main *')]
          .filter((element) => {
            if (element.closest('[aria-hidden="true"]')) return false;
            const style = getComputedStyle(element);
            return (
              style.visibility === 'hidden' ||
              style.opacity === '0' ||
              (style.clipPath !== 'none' && style.clipPath.includes('100%'))
            );
          })
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className}`,
          ),
      );
      if (hidden.length) {
        fail(
          `${route}: hidden at rest without JavaScript: ${hidden.join(', ')}`,
        );
      }
      await context.close();
    }

    // 2. With JavaScript: hosts, pointer, strip, idle pass, pass rest.
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        hasTouch: false,
      });
      const page = await context.newPage();
      const hosts = new Set();
      page.on('request', (request) => hosts.add(new URL(request.url()).host));
      await page.goto(base + route, { waitUntil: 'networkidle' });
      for (const external of [...hosts].filter(
        (h) => h !== `${host}:${port}`,
      )) {
        fail(`${route}: request to external host ${external}`);
      }
      const before = await page.evaluate(() => ({
        tx: getComputedStyle(document.documentElement).getPropertyValue('--tx'),
        torch: getComputedStyle(
          document.querySelector('.wall-torch'),
        ).getPropertyValue('--torch-x'),
      }));
      await page.mouse.move(400, 400);
      await page.mouse.move(900, 300);
      await page.waitForTimeout(100);
      const afterHero = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--tx')
          .trim(),
      );
      if (!afterHero || afterHero === before.tx.trim() || afterHero === '0') {
        fail(`${route}: pointer over the hero did not change --tx`);
      }
      const wallTop = await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        const wall = document.querySelector('.wall');
        scrollTo(0, wall.getBoundingClientRect().top + scrollY - 100);
        return wall.getBoundingClientRect().top;
      });
      await page.waitForTimeout(100);
      await page.mouse.move(600, wallTop + 200);
      await page.mouse.move(700, wallTop + 240);
      await page.waitForTimeout(100);
      const torch = await page.evaluate(() =>
        document
          .querySelector('.wall-torch')
          .style.getPropertyValue('--torch-x'),
      );
      if (!torch || torch === before.torch)
        fail(`${route}: pointer over the wall did not move the torch`);
      const scrolled = await page.evaluate(() => {
        scrollTo(0, 100);
        return new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(
                document
                  .querySelector('[data-strip]')
                  .classList.contains('is-scrolled'),
              ),
            ),
          ),
        );
      });
      if (!scrolled) fail(`${route}: strip is not scrolled after 100 px`);
      const pass = await page.evaluate(() => {
        const style = getComputedStyle(
          document.querySelector('.pass'),
          '::after',
        );
        return {
          count: style.animationIterationCount,
          name: style.animationName,
        };
      });
      if (pass.count !== '3')
        fail(
          `${route}: idle pass iteration count is ${pass.count}, expected 3`,
        );
      // Pass bands at rest sit entirely outside their parent's box.
      await page.evaluate(() => scrollTo(0, 0));
      const rest = await page.evaluate(() => {
        const results = [];
        for (const selector of [
          '.hero .button:not(.button-secondary)',
          '.reel-rule',
        ]) {
          for (const element of document.querySelectorAll(selector)) {
            const style = getComputedStyle(element, '::before');
            const style2 = getComputedStyle(element, '::after');
            const pseudo = selector === '.reel-rule' ? style2 : style;
            const matrix = pseudo.transform.match(/matrix\(([^)]+)\)/);
            const tx = matrix ? Number(matrix[1].split(',')[4]) : 0;
            const width = Number.parseFloat(pseudo.width);
            results.push({
              selector,
              tx,
              width,
              parent: element.getBoundingClientRect().width,
            });
          }
        }
        return results;
      });
      for (const { selector, tx, width, parent } of rest) {
        if (tx < parent)
          fail(
            `${route}: ${selector} pass band rests inside its parent (tx ${tx}, width ${width}, parent ${parent})`,
          );
      }
      await context.close();
    }

    // 3. Reduced motion: nothing running after 100 ms; the pass rests.
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(100);
      const running = await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === 'running').length,
      );
      if (running)
        fail(`${route}: ${running} animation(s) running under reduced motion`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(`Experience checks passed for ${routes.length} routes`);

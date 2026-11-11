/**
 * Experience checks for the marketing routes. Runs against a built dist/
 * through the static preview and asserts, per route:
 *  - nothing inside <main> is hidden at rest without JavaScript;
 *  - no request leaves the preview host;
 *  - no video is requested before the first scroll;
 *  - a loop plays only while it is on screen, can be paused, and is neither
 *    fetched nor started under reduced motion or Save-Data;
 *  - a full scroll shifts the layout by no more than 0.05;
 *  - the scan demo answers a barcode with its record;
 *  - the bar takes the colour of the chapter beneath it;
 *  - under reduced motion nothing is running after 100 ms;
 *  - the compiled CSS animates no background-position, filter or box-shadow;
 *  - axe reports no serious or critical violation at 1440 and 390 px, in
 *    the dark and in the light scheme;
 *  - the theme choice sets the scheme, survives a reload and can be undone;
 * and, on three routes at four widths, that the page never scrolls sideways.
 *
 * Release 3.0 replaced the Pressed Light homepage with colour chapters on
 * the house style (design source: Flux76HQ/App-Guidance,
 * projects/discvault/website/chrome-and-blue-web.md, and ADR-0021). Each
 * block that changed for that reason says below what it asserted in 2.0.
 *
 * Set DV_CHROMIUM_PATH to run against a Chromium other than the one
 * Playwright installs; without it Playwright's own browser is used.
 */
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const host = '127.0.0.1';
const port = 4177;
const base = `http://${host}:${port}`;
const routes = ['/', '/nl/'];
// Sideways scroll shows up with long words and wide glyphs, so the widths
// are tried in English, in German and in Japanese.
const overflowRoutes = ['/', '/de/', '/ja/'];
const overflowViewports = [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1440, 900],
];
const layoutShiftLimit = 0.05;
const executablePath = process.env.DV_CHROMIUM_PATH || undefined;

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
// A preview that dies mid-run would otherwise surface as a refused
// connection with no hint of the cause.
let stopping = false;
server.on('exit', (code, signal) => {
  if (!stopping) {
    console.error(
      `Static preview stopped unexpectedly (code ${code}, signal ${signal})`,
    );
  }
});
const stopServer = () => {
  stopping = true;
  server.kill();
};

const failures = new Set();
const fail = (message) => failures.add(message);
const notes = new Set();
const note = (message) => notes.add(message);

// Compiled CSS (inlined into the pages, or emitted as files): no animated
// background-position, filter or box-shadow.
const cssSources = [];
for (const route of routes) {
  const file = path.join(
    'dist',
    route === '/' ? 'index.html' : path.join(route, 'index.html'),
  );
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    cssSources.push({ name: `${file} <style>`, css: match[1] });
  }
}
const cssDir = path.join('dist', '_astro');
for (const file of await readdir(cssDir).catch(() => [])) {
  if (file.endsWith('.css')) {
    cssSources.push({
      name: file,
      css: await readFile(path.join(cssDir, file), 'utf8'),
    });
  }
}
if (!cssSources.length) fail('no compiled CSS found to inspect');
for (const { name, css } of cssSources) {
  for (const block of css.match(
    /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
  ) ?? []) {
    for (const property of ['background-position', 'filter', 'box-shadow']) {
      if (block.includes(`${property}:`)) {
        fail(`${name} animates ${property} in ${block.slice(0, 40)}…`);
      }
    }
  }
}

const isMedia = (url) => /\.(?:mp4|webm)$/i.test(new URL(url).pathname);

/**
 * Watch a page's network: which hosts it talks to, which videos it asks
 * for, and whether anything other than a video is still in flight. (A
 * paused video can hold its connection open, so it never counts as busy.)
 */
function track(page, route) {
  const media = [];
  const inFlight = new Set();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.host !== `${host}:${port}`) {
      fail(`${route}: request to external host ${url.host}`);
    }
    if (isMedia(request.url())) media.push(url.pathname);
    else inFlight.add(request);
  });
  const done = (request) => inFlight.delete(request);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return {
    media,
    /** Resolves once nothing has been in flight for a quarter second. */
    async idle(limit = 10_000) {
      const deadline = Date.now() + limit;
      let quietSince = Date.now();
      while (Date.now() < deadline) {
        if (inFlight.size) quietSince = Date.now();
        else if (Date.now() - quietSince >= 250) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}

/** Wait for every finite animation and transition to finish. */
async function settle(page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().endTime !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  );
}

/** Scroll from the top of the page to its end, a viewport at a time. */
async function scrollThrough(page, network) {
  await page.evaluate(async () => {
    const frames = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const step = Math.max(200, Math.floor(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo({ top: y, behavior: 'instant' });
      await frames();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    });
    await frames();
  });
  await network.idle();
  await settle(page);
}

const loopState = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('video[data-loop]')].map((video) => ({
      slot: video.closest('[data-media]')?.dataset.media ?? '?',
      paused: video.paused,
    })),
  );

/**
 * A context in which loops must stay still (reduced motion, Save-Data):
 * after a full scroll no video was requested and every loop is paused.
 */
async function expectStillLoops(page, network, route, condition) {
  await scrollThrough(page, network);
  if (network.media.length) {
    fail(
      `${route}: video requested ${condition}: ${[...new Set(network.media)].join(', ')}`,
    );
  }
  const playing = (await loopState(page)).filter((loop) => !loop.paused);
  if (playing.length) {
    fail(
      `${route}: loop playing ${condition}: ${playing.map((loop) => loop.slot).join(', ')}`,
    );
  }
}

let browser;
try {
  browser = await chromium.launch(executablePath ? { executablePath } : {});
} catch (error) {
  stopServer();
  throw error;
}
try {
  for (const route of routes) {
    let loopCount = 0;

    /**
     * 1. No JavaScript: nothing hidden inside main.
     *
     * 2.0 waited a fixed 2.8 s here for the hero's entrance, a lighting
     * change that played without script. 3.0 has no scriptless entrance:
     * the class that holds a part back is set by the motion script alone,
     * so the page is judged as soon as its finite animations have ended.
     * Three things are not "hidden content": decorative (aria-hidden)
     * layers; the body of a closed <details>, which the reader opens; and a
     * radio or checkbox drawn by its own visible label.
     */
    {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      track(page, route);
      await page.goto(base + route, { waitUntil: 'load' });
      await settle(page);
      const hidden = await page.evaluate(() =>
        [...document.querySelectorAll('main *')]
          .filter((element) => {
            if (element.closest('[aria-hidden="true"]')) return false;
            if (
              element.closest('details:not([open])') &&
              !element.closest('summary')
            ) {
              return false;
            }
            if (
              element.matches(
                'label input[type="radio"], label input[type="checkbox"]',
              )
            ) {
              return false;
            }
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

    /**
     * 2. With JavaScript, at desktop width.
     *
     * 2.0 asserted the Pressed Light motion here: the pointer drove the
     * hero tilt (`--tx`) and the wall torch (`.wall-torch`), the strip took
     * `.is-scrolled` after 100 px, the idle pass (`.pass`) repeated three
     * times and its bands rested outside the hero button and `.reel-rule`.
     * None of those parts exist in 3.0. What moves now is the media (muted
     * loops under ADR-0021 decision 5), the scan demo and the bar's colour,
     * so those are what this block holds to their rules.
     */
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        hasTouch: false,
      });
      await context.addInitScript(() => {
        window.__layoutShift = { supported: false, total: 0, worst: null };
        if (!PerformanceObserver.supportedEntryTypes?.includes('layout-shift'))
          return;
        window.__layoutShift.supported = true;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            const state = window.__layoutShift;
            state.total += entry.value;
            if (!state.worst || entry.value > state.worst.value) {
              const node = entry.sources?.[0]?.node;
              const element =
                node && node.nodeType !== 1 ? node.parentElement : node;
              state.worst = {
                value: entry.value,
                source: element
                  ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
                      typeof element.className === 'string' && element.className
                        ? `.${element.className.trim().split(/\s+/).join('.')}`
                        : ''
                    }`
                  : 'unknown',
              };
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      const page = await context.newPage();
      const network = track(page, route);
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await network.idle();

      // Nothing has been scrolled yet. A loop has `preload="none"` and no
      // `autoplay`, so the only video that may have been asked for is one
      // whose slot is on the first screen (the hero), and the script may only
      // ask for it once the page has finished loading, so it never competes
      // with the first paint. (2.0 allowed no video at all; 3.0 shows the
      // library in motion on the first screen: ADR-0021.)
      const early = await page.evaluate(() => {
        const onScreen = new Set(
          [...document.querySelectorAll('video[data-loop]')]
            .filter((video) => {
              const rect = video.getBoundingClientRect();
              return rect.bottom > 0 && rect.top < window.innerHeight;
            })
            .flatMap((video) =>
              [...video.querySelectorAll('source')].map(
                (source) => new URL(source.src, location.href).pathname,
              ),
            ),
        );
        const [navigation] = performance.getEntriesByType('navigation');
        return performance
          .getEntriesByType('resource')
          .filter((entry) => /\.(webm|mp4)(\?|$)/.test(entry.name))
          .map((entry) => ({
            path: new URL(entry.name).pathname,
            offScreen: !onScreen.has(new URL(entry.name).pathname),
            beforeLoad: entry.startTime < navigation.loadEventStart,
          }));
      });
      for (const request of early) {
        if (request.offScreen) {
          fail(
            `${route}: video requested before any scroll for a slot that is not on the first screen: ${request.path}`,
          );
        }
        if (request.beforeLoad) {
          fail(
            `${route}: video requested before the page finished loading: ${request.path}`,
          );
        }
      }

      await scrollThrough(page, network);
      const shift = await page.evaluate(() => window.__layoutShift);
      if (!shift.supported) {
        fail(`${route}: this browser cannot report layout shifts`);
      } else if (shift.total > layoutShiftLimit) {
        fail(
          `${route}: cumulative layout shift after a full scroll is ${shift.total.toFixed(4)}, limit ${layoutShiftLimit} (largest shift: ${shift.worst.value.toFixed(4)} at ${shift.worst.source})`,
        );
      }

      // The scan demo: a barcode in, its record out, without script.
      const codes = page.locator('input[name="scan-code"]');
      if ((await codes.count()) < 2) {
        fail(`${route}: the scan demo has fewer than two barcodes`);
      } else {
        await codes
          .nth(1)
          .check({ timeout: 5000 })
          .catch(() => fail(`${route}: the second barcode cannot be chosen`));
        const second = await page
          .locator('.record[data-record="2"]')
          .isVisible();
        const first = await page
          .locator('.record[data-record="1"]')
          .isVisible();
        if (!second || first) {
          fail(
            `${route}: choosing the second barcode must show record 2 and hide record 1 (record 2 ${second ? 'shown' : 'hidden'}, record 1 ${first ? 'shown' : 'hidden'})`,
          );
        }
      }

      // The bar takes the ground and ink of the chapter beneath it.
      const barClass = await page.evaluate(async () => {
        const chapter = document.querySelector('#editions');
        const bar = document.querySelector('[data-bar]');
        if (!chapter || !bar) return null;
        scrollTo({
          top: chapter.getBoundingClientRect().top + scrollY,
          behavior: 'instant',
        });
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return bar.className;
      });
      if (barClass === null) {
        fail(`${route}: no [data-bar] or no #editions to test the bar against`);
      } else if (!barClass.split(/\s+/).includes('on-accent')) {
        fail(
          `${route}: with #editions under the bar, [data-bar] is "${barClass}" and lacks on-accent`,
        );
      }

      // Loops: on screen they play, off screen they pause, and each has a
      // working pause control (WCAG 2.2.2).
      loopCount = (await loopState(page)).length;
      if (!loopCount) note(`${route}: no loops on the page`);
      for (let index = 0; index < loopCount; index += 1) {
        const slot = await page.evaluate((i) => {
          const video = document.querySelectorAll('video[data-loop]')[i];
          video.scrollIntoView({ block: 'center', behavior: 'instant' });
          return video.closest('[data-media]')?.dataset.media ?? `#${i}`;
        }, index);
        const waitFor = (playing, timeout) =>
          page
            .waitForFunction(
              ([i, wanted]) => {
                const video = document.querySelectorAll('video[data-loop]')[i];
                const isPlaying =
                  !video.paused &&
                  video.readyState > 2 &&
                  video.currentTime > 0;
                return wanted ? isPlaying : video.paused;
              },
              [index, playing],
              { timeout },
            )
            .then(
              () => true,
              () => false,
            );
        if (!(await waitFor(true, 10_000))) {
          fail(`${route}: loop "${slot}" did not start playing on screen`);
          continue;
        }
        const toggle = page
          .locator('video[data-loop]')
          .nth(index)
          .locator('xpath=..')
          .locator('[data-loop-toggle]');
        if (!(await toggle.count()) || !(await toggle.isVisible())) {
          fail(`${route}: loop "${slot}" plays without a visible pause button`);
        } else {
          // A press that cannot land leaves the state as it was, which the
          // wait that follows reports.
          const press = () => toggle.click({ timeout: 5000 }).catch(() => {});
          await press();
          if (!(await waitFor(false, 3000))) {
            fail(`${route}: the pause button did not pause loop "${slot}"`);
          }
          await press();
          if (!(await waitFor(true, 5000))) {
            fail(`${route}: the pause button did not resume loop "${slot}"`);
          }
        }
        const stillOnScreen = await page.evaluate((i) => {
          const video = document.querySelectorAll('video[data-loop]')[i];
          const top = video.getBoundingClientRect().top + scrollY;
          scrollTo({
            top:
              top > innerHeight * 1.5
                ? 0
                : document.documentElement.scrollHeight,
            behavior: 'instant',
          });
          const rect = video.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        }, index);
        if (stillOnScreen) {
          note(`${route}: loop "${slot}" cannot be scrolled off screen`);
        } else if (!(await waitFor(false, 3000))) {
          fail(`${route}: loop "${slot}" kept playing off screen`);
        }
      }
      if (loopCount) {
        note(
          `${route}: ${loopCount} loop(s) tried on screen, at the pause button and off screen`,
        );
      }
      await context.close();
    }

    /**
     * 3. Accessibility: axe at desktop and phone widths. 2.0 waited 2.8 s
     * for the hero entrance; 3.0 scrolls the page through first, so every
     * part has risen and is tested at its resting colours.
     */
    for (const [width, colorScheme] of [
      [1440, 'dark'],
      [390, 'dark'],
      [1440, 'light'],
      [390, 'light'],
    ]) {
      // Every page follows the system scheme, so both are tested: a pair
      // that is legible in one can fail in the other.
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        colorScheme,
      });
      const page = await context.newPage();
      const network = track(page, route);
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await scrollThrough(page, network);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await settle(page);
      const results = await new AxeBuilder({ page })
        .withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21aa',
          'wcag22aa',
          'best-practice',
        ])
        .analyze();
      for (const violation of results.violations) {
        if (violation.impact === 'serious' || violation.impact === 'critical') {
          fail(
            `${route} @${width} ${colorScheme}: axe ${violation.impact} ${violation.id} on ${violation.nodes
              .slice(0, 3)
              .map((node) => node.target.join(' '))
              .join(', ')}`,
          );
        }
      }
      await context.close();
    }

    /**
     * 3b. The theme choice. The system scheme decides until the visitor
     * picks one; the pick is `data-theme` on the root element, changes the
     * ground at once, survives a reload without a flash of the other
     * scheme (the layout applies it before first paint) and can be undone.
     */
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
      });
      const page = await context.newPage();
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const ground = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const select = page.locator('[data-theme-switcher] select').first();
      const dark = await ground();
      if (!(await select.isVisible())) {
        fail(`${route}: the theme switcher is not shown`);
      } else {
        await select.selectOption('light');
        const light = await ground();
        if (light === dark) {
          fail(`${route}: choosing the light theme did not change the ground`);
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        if ((await ground()) !== light) {
          fail(`${route}: the theme choice did not survive a reload`);
        }
        await page.waitForLoadState('networkidle');
        await page
          .locator('[data-theme-switcher] select')
          .first()
          .selectOption('system');
        if ((await ground()) !== dark) {
          fail(
            `${route}: choosing "system" did not return to the system scheme`,
          );
        }
      }
      await context.close();
    }

    // 4. Reduced motion: nothing running after 100 ms, and no loop is
    //    fetched or started however far the page is scrolled.
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const network = track(page, route);
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
      if (loopCount) {
        await expectStillLoops(page, network, route, 'under reduced motion');
      }
      await context.close();
    }

    // 5. Save-Data: the same promise for a visitor who asked for less data.
    if (loopCount) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'connection', {
          configurable: true,
          get: () => ({ saveData: true, addEventListener() {} }),
        });
      });
      const page = await context.newPage();
      const network = track(page, route);
      await page.goto(base + route, { waitUntil: 'networkidle' });
      if (
        !(await page.evaluate(() => navigator.connection?.saveData === true))
      ) {
        fail(`${route}: could not stub navigator.connection.saveData`);
      }
      await expectStillLoops(page, network, route, 'with Save-Data on');
      await context.close();
    }
  }

  // 6. No sideways scroll, at four widths in three scripts' worth of copy.
  for (const [width, height] of overflowViewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    for (const route of overflowRoutes) {
      const page = await context.newPage();
      track(page, route);
      await page.goto(base + route, { waitUntil: 'load' });
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        if (root.scrollWidth <= innerWidth) return null;
        // Name the parts that widen the page: those that reach past the
        // right edge, are actually rendered, and are not cut off by an
        // ancestor that clips or scrolls its own overflow.
        const widens = (element) => {
          const rect = element.getBoundingClientRect();
          if (rect.right <= innerWidth + 0.5 || !rect.width) return false;
          if (
            element.closest('details:not([open])') &&
            !element.closest('summary')
          ) {
            return false;
          }
          for (
            let parent = element.parentElement;
            parent && parent !== document.body;
            parent = parent.parentElement
          ) {
            if (getComputedStyle(parent).overflowX !== 'visible') return false;
          }
          return true;
        };
        const wide = [...document.querySelectorAll('body *')].filter(widens);
        const culprits = wide
          // Innermost first: a parent is only wide because of its child.
          .filter(
            (element) =>
              !wide.some(
                (other) => other !== element && element.contains(other),
              ),
          )
          .sort(
            (a, b) =>
              b.getBoundingClientRect().right - a.getBoundingClientRect().right,
          )
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}${
                typeof element.className === 'string' && element.className
                  ? `.${element.className.trim().split(/\s+/).join('.')}`
                  : ''
              } (to ${Math.round(element.getBoundingClientRect().right)} px)`,
          );
        return {
          scrollWidth: root.scrollWidth,
          culprits: [...new Set(culprits)].slice(0, 6),
        };
      });
      if (overflow) {
        fail(
          `${route} @${width}: the page scrolls sideways (scrollWidth ${overflow.scrollWidth} > ${width}); reaching past the edge: ${overflow.culprits.join(', ') || 'unknown'}`,
        );
      }
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  stopServer();
}

for (const message of notes) console.log(`· ${message}`);
if (failures.size) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(
  `Experience checks passed for ${routes.length} routes, and no sideways scroll on ${overflowRoutes.length} routes at ${overflowViewports.length} widths`,
);

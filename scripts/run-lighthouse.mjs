import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = 4173;
const urls = [
  `http://${host}:${port}/`,
  `http://${host}:${port}/nl/`,
  `http://${host}:${port}/privacy.html`,
];
// The floors are unchanged from 2.0 (ADR-0021, decision 6).
const budgets = {
  performance: 0.8,
  accessibility: 0.95,
  'best-practices': 0.9,
  seo: 0.95,
};
// One Lighthouse run can land a few points either side of the true score,
// which is enough to fail a page that sits near the performance floor. Each
// URL is therefore measured three times and judged on the median of each
// category: a single slow run no longer fails the gate, a slow page still
// does.
const runsPerUrl = 3;
// Set DV_CHROMIUM_PATH to measure with a Chromium other than the one
// Playwright installs; without it Playwright's own browser is used.
const chromePath = process.env.DV_CHROMIUM_PATH || chromium.executablePath();

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

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
  server.once('exit', (code) =>
    reject(new Error(`Static preview exited with code ${code}`)),
  );
  server.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('DiscVault dist preview:')) {
      clearTimeout(timeout);
      resolve();
    }
  });
});

let chrome;
let failed = false;
try {
  chrome = await launch({
    chromePath,
    chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  await mkdir('.lighthouseci/reports', { recursive: true });

  for (const url of urls) {
    const runs = [];
    for (let run = 0; run < runsPerUrl; run += 1) {
      const result = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: Object.keys(budgets),
      });
      if (!result) throw new Error(`Lighthouse returned no result for ${url}`);
      runs.push({
        report: result.report,
        scores: Object.fromEntries(
          Object.keys(budgets).map((category) => [
            category,
            result.lhr.categories[category]?.score ?? 0,
          ]),
        ),
      });
    }

    const scores = Object.fromEntries(
      Object.entries(budgets).map(([category, minimum]) => {
        const score = median(runs.map((run) => run.scores[category]));
        if (score < minimum) failed = true;
        return [category, score];
      }),
    );
    // Keep the report of the run whose performance score is the median, so
    // the saved detail explains the number that was judged.
    const representative =
      runs.find((run) => run.scores.performance === scores.performance) ??
      runs[0];
    const slug =
      new URL(url).pathname.replaceAll(/[^a-z0-9]+/gi, '-') || 'home';
    await writeFile(
      `.lighthouseci/reports/${slug}.json`,
      representative.report,
      'utf8',
    );
    console.log(
      `${url} ${Object.entries(scores)
        .map(
          ([name, score]) =>
            `${name}=${Math.round(score * 100)}${score < budgets[name] ? ` (below ${Math.round(budgets[name] * 100)})` : ''}`,
        )
        .join(
          ' ',
        )} — median of ${runsPerUrl}; performance runs ${runs.map((run) => Math.round(run.scores.performance * 100)).join('/')}`,
    );
  }
} finally {
  try {
    if (chrome) await chrome.kill();
  } catch {
    console.warn(
      'Chromium exited but its temporary profile cleanup was delayed',
    );
  } finally {
    server.kill();
  }
}

if (failed) {
  console.error('One or more Lighthouse category budgets failed');
  process.exit(1);
}

console.log('Lighthouse category budgets passed');

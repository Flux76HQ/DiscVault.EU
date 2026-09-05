import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFile, rm, writeFile } from 'node:fs/promises';

const exactHtmlRoutes = [
  'faq.html',
  'privacy.html',
  'privacy-nl.html',
  'terms.html',
  'terms-nl.html',
];

function exactHtmlOutput() {
  return {
    name: 'discvault-exact-html-output',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        for (const route of exactHtmlRoutes) {
          const directoryUrl = new URL(`${route}/`, dir);
          const html = await readFile(new URL('index.html', directoryUrl));
          await rm(directoryUrl, { recursive: true });
          await writeFile(new URL(route, dir), html);
        }
      },
    },
  };
}

export default defineConfig({
  site: 'https://discvault.eu',
  output: 'static',
  integrations: [
    sitemap({
      filter: (page) =>
        !exactHtmlRoutes.some((route) => page.endsWith(`/${route}/`)),
      customPages: [
        'https://discvault.eu/privacy.html',
        'https://discvault.eu/privacy-nl.html',
        'https://discvault.eu/terms.html',
        'https://discvault.eu/terms-nl.html',
        'https://discvault.eu/legacy/',
      ],
    }),
    exactHtmlOutput(),
  ],
  build: {
    // One request fewer before first paint: the page's CSS ships inline.
    inlineStylesheets: 'always',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});

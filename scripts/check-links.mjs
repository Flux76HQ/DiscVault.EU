import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { descendants, parseHtml } from './lib/html.mjs';

const root = path.resolve('dist');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : target;
      }),
    )
  ).flat();
}

function outputTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  if (clean.endsWith('/')) return path.join(root, clean, 'index.html');
  return path.join(root, clean);
}

// Attributes that hold one URL, and attributes that hold a candidate list.
// `src` and `srcset` cover <img>, <script> and the <source> children of
// <picture> and <video>; `poster` and `imagesrcset` (on a preload link) are
// the two a media slot adds.
const urlAttributes = ['href', 'src', 'poster'];
const candidateListAttributes = ['srcset', 'imagesrcset'];

const files = await walk(root);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const errors = [];
let checked = 0;

/** Check one reference found in `file` (an absolute path inside dist/). */
async function check(file, value) {
  if (
    !value ||
    value.startsWith('#') ||
    /^(?:https?:|mailto:|tel:|data:)/i.test(value)
  ) {
    return;
  }
  const resolved = value.startsWith('/')
    ? new URL(value, 'https://discvault.eu').pathname
    : path
        .relative(root, path.resolve(path.dirname(file), value.split('#')[0]))
        .replaceAll('\\', '/');
  const target = outputTarget(
    value.startsWith('/') ? resolved : `/${resolved}`,
  );
  checked += 1;
  try {
    await access(target);
  } catch {
    errors.push(
      `${path.relative(root, file)} -> ${value} (missing ${path.relative(root, target)})`,
    );
  }
}

for (const file of htmlFiles) {
  const document = parseHtml(await readFile(file, 'utf8'));
  const values = [];
  for (const node of descendants(document.root)) {
    for (const attribute of urlAttributes) {
      if (attribute in node.attrs) values.push(node.attrs[attribute].trim());
    }
    for (const attribute of candidateListAttributes) {
      if (attribute in node.attrs) {
        values.push(
          ...node.attrs[attribute]
            .split(',')
            .map((part) => part.trim().split(/\s+/)[0]),
        );
      }
    }
  }
  for (const value of values) await check(file, value);
}

// The web app manifest names its icons by path; a browser fetches them when
// the site is installed, long after any page-level check has run. The file
// is optional: it is checked when the build contains one.
const manifestFile = path.join(root, 'site.webmanifest');
const manifestSource = await readFile(manifestFile, 'utf8').catch(() => null);
if (manifestSource !== null) {
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    errors.push(`site.webmanifest is not valid JSON (${error.message})`);
  }
  const images = [
    ...(manifest?.icons ?? []),
    ...(manifest?.screenshots ?? []),
    ...(manifest?.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? []),
  ];
  if (manifest && !manifest.icons?.length) {
    errors.push('site.webmanifest lists no icons');
  }
  for (const image of images) await check(manifestFile, image?.src);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(
  `Internal link check passed: ${checked} asset/page references across ${htmlFiles.length} HTML files${manifestSource === null ? '' : ' and the web app manifest'}`,
);

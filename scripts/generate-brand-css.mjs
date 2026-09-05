import { readFile, writeFile } from 'node:fs/promises';

const tokens = JSON.parse(await readFile('src/design/tokens.json', 'utf8'));
const source = JSON.parse(await readFile('src/design/source.json', 'utf8'));
const outputPath = 'src/styles/tokens.css';
const pinOutputPath = 'src/styles/tokens-dark-pin.css';
const scopeOutputPath = 'src/styles/tokens-dark-scope.css';

const variableName = (key) => `--dv-${key}`;
const themeLines = (theme) =>
  Object.entries(tokens.theme[theme])
    .map(([key, token]) => `  ${variableName(key)}: ${token.$value};`)
    .join('\n');

const accent = tokens.accent.presets.bluray;
const formatLines = (theme) =>
  [
    `  --dv-fmt-4k-fill: ${tokens.format['4k'][theme].fill};`,
    `  --dv-fmt-4k-on: ${tokens.format['4k'][theme].on};`,
    `  --dv-fmt-bluray-fill: ${tokens.format.bluray[theme].fill};`,
    `  --dv-fmt-bluray-on: ${tokens.format.bluray[theme].on};`,
    `  --dv-fmt-dvd-fill: ${tokens.format.dvd[theme].fill};`,
    `  --dv-fmt-dvd-deep: ${tokens.format.dvd[theme].deep};`,
    `  --dv-fmt-dvd-on: ${tokens.format.dvd[theme].on};`,
    `  --dv-fmt-steel-fill: ${tokens.format.steel[theme].fill};`,
    `  --dv-fmt-steel-on: ${tokens.format.steel[theme].on};`,
    `  --dv-fmt-steel-brushed: ${tokens.format.steel[theme].brushed};`,
    `  --dv-fmt-digital-fill: ${tokens.format.digital[theme].fill};`,
    `  --dv-fmt-digital-on: ${tokens.format.digital[theme].on};`,
  ].join('\n');
const generated = `/*
 * Generated from ${source.repository}/${source.tokens}
 * Revision: ${source.revision}
 * Brand: ${source.brand}
 * Run "pnpm brand:build" after updating tokens.json.
 */
:root {
${themeLines('dark')}
  --dv-accent: ${accent.base};
  --dv-accent-hover: ${accent.hover};
  --dv-accent-press: ${accent.press};
  --dv-accent-bright: ${accent['bright-dark']};
  --dv-accent-on: ${accent.on};
  --dv-sheen: ${tokens.effect.sheen.dark.$value};
  --dv-shadow: ${tokens.effect.shadow.dark.$value};
  --dv-theme-color: ${tokens.pwa['theme-color-dark'].$value};
${formatLines('dark')}
}

@media (prefers-color-scheme: light) {
  :root {
${themeLines('light')}
${formatLines('light')}
    --dv-accent-bright: ${accent['bright-light']};
    --dv-sheen: ${tokens.effect.sheen.light.$value};
    --dv-shadow: ${tokens.effect.shadow.light.$value};
    --dv-theme-color: ${tokens.pwa['theme-color-light'].$value};
  }
}
`;

// The marketing routes are dark-only. tokens.css still carries the light
// scheme for the legal shell, so this second file re-pins the dark values on
// marketing routes (imported only there) with a selector that outranks the
// light media query in tokens.css.
const pinned = `/*
 * Generated from ${source.repository}/${source.tokens}
 * Dark-only pin for the marketing routes. Run "pnpm brand:build" after
 * updating tokens.json.
 */
@media (prefers-color-scheme: light) {
  html:root {
${themeLines('dark')}
    --dv-accent-bright: ${accent['bright-dark']};
    --dv-sheen: ${tokens.effect.sheen.dark.$value};
    --dv-shadow: ${tokens.effect.shadow.dark.$value};
    --dv-theme-color: ${tokens.pwa['theme-color-dark'].$value};
${formatLines('dark')}
  }
}
`;

// The shell (strip and credits) is a dark object on every page, including
// the light-capable legal shell: this scoped file pins the dark values on
// `.cine-dark` in both schemes.
const scoped = `/*
 * Generated from ${source.repository}/${source.tokens}
 * Dark values scoped to .cine-dark (the strip and the credits) in both
 * schemes. Run "pnpm brand:build" after updating tokens.json.
 */
.cine-dark {
${themeLines('dark')}
  --dv-accent-bright: ${accent['bright-dark']};
  --dv-sheen: ${tokens.effect.sheen.dark.$value};
  --dv-shadow: ${tokens.effect.shadow.dark.$value};
${formatLines('dark')}
}
`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  const currentPin = await readFile(pinOutputPath, 'utf8').catch(() => '');
  const currentScope = await readFile(scopeOutputPath, 'utf8').catch(() => '');
  if (
    current !== generated ||
    currentPin !== pinned ||
    currentScope !== scoped
  ) {
    console.error('Brand CSS is stale. Run: pnpm brand:build');
    process.exit(1);
  }
  console.log('Brand CSS matches Chrome & Blue v3.1 source tokens');
} else {
  await writeFile(outputPath, generated);
  await writeFile(pinOutputPath, pinned);
  await writeFile(scopeOutputPath, scoped);
  console.log(
    `Generated ${outputPath}, ${pinOutputPath} and ${scopeOutputPath}`,
  );
}

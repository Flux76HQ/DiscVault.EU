import { readFile, writeFile } from 'node:fs/promises';

const tokens = JSON.parse(await readFile('src/design/tokens.json', 'utf8'));
const source = JSON.parse(await readFile('src/design/source.json', 'utf8'));
const outputPath = 'src/styles/tokens.css';
const pinOutputPath = 'src/styles/tokens-dark-pin.css';

const variableName = (key) => `--dv-${key}`;
const themeLines = (theme) =>
  Object.entries(tokens.theme[theme])
    .map(([key, token]) => `  ${variableName(key)}: ${token.$value};`)
    .join('\n');

const accent = tokens.accent.presets.bluray;
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
}

@media (prefers-color-scheme: light) {
  :root {
${themeLines('light')}
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
  }
}
`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  const currentPin = await readFile(pinOutputPath, 'utf8').catch(() => '');
  if (current !== generated || currentPin !== pinned) {
    console.error('Brand CSS is stale. Run: pnpm brand:build');
    process.exit(1);
  }
  console.log('Brand CSS matches Chrome & Blue v3.1 source tokens');
} else {
  await writeFile(outputPath, generated);
  await writeFile(pinOutputPath, pinned);
  console.log(`Generated ${outputPath} and ${pinOutputPath}`);
}

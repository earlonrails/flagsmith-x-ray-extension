import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

async function main() {
  // 1. Build HTML/React entry points (popup.html, panel.html, devtools.html)
  await viteBuild({ configFile: path.join(ROOT, 'vite.config.ts') });

  // 2. Build standalone MV3 scripts as single-file IIFE bundles
  const scriptEntries = [
    { in: 'src/interceptor.ts', out: 'interceptor.js' },
    { in: 'src/content.ts', out: 'content.js' },
    { in: 'src/background.ts', out: 'background.js' },
  ];

  await Promise.all(
    scriptEntries.map((entry) =>
      esbuild({
        entryPoints: [path.join(ROOT, entry.in)],
        outfile: path.join(DIST, entry.out),
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: ['chrome114'],
        minify: false,
        sourcemap: false,
      })
    )
  );

  // 3. Copy manifest.json into dist/
  await fs.copyFile(
    path.join(ROOT, 'public', 'manifest.json'),
    path.join(DIST, 'manifest.json')
  );

  console.log('Extension build complete -> extension/dist/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

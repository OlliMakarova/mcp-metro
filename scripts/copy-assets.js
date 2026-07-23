// Copies runtime assets that tsc does not emit into dist/ after compilation.
// Currently: the MCP Apps route widget HTML, read at runtime by
// src/tools/metro/widget-resource.ts from the directory of the compiled module.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** [source, destination] pairs relative to the project root */
const ASSETS = [['src/tools/metro/routes-widget.html', 'dist/src/tools/metro/routes-widget.html']];

for (const [from, to] of ASSETS) {
  const src = path.join(ROOT, from);
  const dst = path.join(ROOT, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`copy-assets: ${from} -> ${to}`);
}

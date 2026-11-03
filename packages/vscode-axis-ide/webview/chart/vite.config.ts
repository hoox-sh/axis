// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const packageRoot = resolve(__dirname, '../..');
const repoRoot = resolve(packageRoot, '../..');

/** Prefer package-local LWC, else monorepo root (sibling package layout). */
function resolveLwcEntry(): string {
  const candidates = [
    resolve(packageRoot, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs'),
    resolve(repoRoot, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall through to bare id — Vite/node resolution may still find it.
  return 'lightweight-charts';
}

/** Chart webview → packages/vscode-axis-ide/dist/webview/chart/ (design packaging topology). */
export default defineConfig({
  root: resolve(__dirname),
  base: './',
  publicDir: false,
  resolve: {
    alias: {
      'lightweight-charts': resolveLwcEntry(),
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/webview/chart'),
    emptyOutDir: true,
    target: 'es2020',
    // No maps in dist — vsce parent-dir negations otherwise ship main.js.map (sourcesContent).
    sourcemap: false,
    minify: true,
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      formats: ['iife'],
      name: 'AxisChartWebview',
      fileName: () => 'main.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: 'main.[ext]',
      },
    },
  },
});

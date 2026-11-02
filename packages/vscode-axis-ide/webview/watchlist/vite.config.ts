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

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Watchlist webview → packages/vscode-axis-ide/dist/webview/watchlist/ */
export default defineConfig({
  root: resolve(__dirname),
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(__dirname, '../../dist/webview/watchlist'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    minify: true,
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      formats: ['iife'],
      name: 'AxisWatchlistWebview',
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

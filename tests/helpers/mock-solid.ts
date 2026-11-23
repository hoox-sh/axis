/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Bun test preload — give Bun's JSX transform a real runtime to import.
 *
 * The app compiles JSX through `vite-plugin-solid` (babel), which emits
 * `_$createComponent` calls and never touches the automatic runtime. Bun, with
 * no babel step, falls back to the automatic runtime and imports `jsxDEV` from
 * `solid-js/jsx-dev-runtime` — an export map that resolves to `dist/solid.js`,
 * which has no `jsxDEV`. Every test whose import graph reached a `.tsx` failed
 * with:
 *
 *   SyntaxError: Export named 'jsxDEV' not found in
 *     node_modules/solid-js/dist/solid.js
 *
 * `solid-js/h/jsx-dev-runtime` is the hyperscript runtime that actually
 * implements `jsxDEV` (Fragment, jsx, jsxDEV, jsxs), so alias the two automatic
 * runtime specifiers onto it before any module loads.
 *
 * Hyperscript's `insert` comes from `solid-js/web`. Bun resolves that specifier
 * to the server build, whose `insert` throws "Client-only API". Alias the
 * client build first so a test can mount JSX. `solid-js` itself stays on the
 * server build (inert effects) so the rest of the suite does not start
 * subscribing.
 */

import { mock } from 'bun:test';

const web = await import('solid-js/web/dist/dev.js');
mock.module('solid-js/web', () => web);

const h = await import('solid-js/h/jsx-dev-runtime').catch(() => null);

if (h) {
  const exports = h as unknown as Record<string, unknown>;
  for (const specifier of ['solid-js/jsx-dev-runtime', 'solid-js/jsx-runtime']) {
    mock.module(specifier, () => exports);
  }
}

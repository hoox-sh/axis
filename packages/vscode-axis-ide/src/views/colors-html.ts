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

import { escapeHtmlAttr, htmlHasInlineScript } from '../editors/chart-html';

/** Inputs for the Colors panel shell (URIs already asWebviewUri). */
export interface ColorsHtmlOptions {
  /** `webview.cspSource` — never hard-code resource schemes here. */
  cspSource: string;
  /** Per-document nonce. Included on `script-src` and the script tag only. */
  nonce: string;
  scriptUri: string;
  styleUri: string;
  /** VS Code theme body class. Defaults to `vscode-dark`. */
  bodyClass?: string;
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Colors</title>
</head>
<body>
  <div id="colors-root" class="colors-root" data-axis-colors-host="1">
    <p id="colors-empty" class="colors-root__empty" role="status">No colors in this script</p>
    <ul id="colors-list" class="colors-list" aria-label="Colors in this script"></ul>
  </div>
</body>
</html>
`;

/** Nonce token safe to drop inside `'nonce-…'` without breaking the CSP attribute. */
function sanitizeNonce(raw: string): string {
  return raw.replace(/[^A-Za-z0-9+/=_-]/g, '');
}

/**
 * CSP + HTML shell for the Colors webview (`axis.colors`).
 * Plugins matrix, plus a script nonce. `style-src` stays
 * `cspSource` and `'unsafe-inline'` (no style nonce). `connect-src 'none'`.
 * Rows are filled by the webview script. Never throws.
 */
export function getColorsHtml(opts?: ColorsHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? opts
        : ({} as ColorsHtmlOptions);
    const cspSource = String(rec.cspSource ?? '');
    const nonce = sanitizeNonce(String(rec.nonce ?? ''));
    const scriptUri = String(rec.scriptUri ?? '');
    const styleUri = String(rec.styleUri ?? '');
    const bodyClass = String(rec.bodyClass ?? 'vscode-dark').replace(/[^a-zA-Z0-9_-]/g, '');

    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `script-src 'nonce-${nonce}' ${cspSource}`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `img-src ${cspSource} data: blob:`,
      "connect-src 'none'",
    ].join('; ');

    const safeCsp = escapeHtmlAttr(csp);
    const safeNonce = escapeHtmlAttr(nonce);
    const safeScript = escapeHtmlAttr(scriptUri);
    const safeStyle = escapeHtmlAttr(styleUri);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${safeCsp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Colors</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${bodyClass}" data-axis-colors-kind="colors">
  <div id="colors-root" class="colors-root" data-axis-colors-host="1">
    <header class="colors-root__header">
      <h1 class="colors-root__title">Colors</h1>
      <p class="colors-root__meta">
        <span id="colors-count" class="colors-count">0 colors</span>
        <span id="colors-source" class="colors-source"></span>
      </p>
    </header>
    <p id="colors-empty" class="colors-root__empty" role="status">No colors in this script</p>
    <ul id="colors-list" class="colors-list" aria-label="Colors in this script"></ul>
  </div>
  <script nonce="${safeNonce}" src="${safeScript}"></script>
</body>
</html>
`;
  } catch {
    return FALLBACK_HTML;
  }
}

export { escapeHtmlAttr, htmlHasInlineScript };

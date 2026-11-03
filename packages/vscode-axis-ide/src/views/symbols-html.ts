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

/** Inputs for the Symbols panel shell (URIs already asWebviewUri). */
export interface SymbolsHtmlOptions {
  /** `webview.cspSource` — never hard-code resource schemes here. */
  cspSource: string;
  /** Per-document nonce. Included on `script-src` and the script tag only. */
  nonce: string;
  scriptUri: string;
  styleUri: string;
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Symbols</title>
</head>
<body>
  <div id="symbols-live" class="symbols-live" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="symbols-root" class="symbols-root" data-axis-symbols-host="1"></div>
</body>
</html>
`;

/** Nonce token safe to drop inside `'nonce-…'` without breaking the CSP attribute. */
function sanitizeNonce(raw: string): string {
  return raw.replace(/[^A-Za-z0-9+/=_-]/g, '');
}

/**
 * CSP + HTML shell for the Symbols webview (`axis.symbols`).
 * script-src is the plugins matrix plus `'nonce-…'`.
 * style-src matches plugins: cspSource and `'unsafe-inline'`, no style nonce.
 * connect-src is `'none'`. Never throws.
 */
export function buildSymbolsWebviewHtml(opts?: SymbolsHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : ({} as SymbolsHtmlOptions);
    const cspSource = String(rec.cspSource ?? '');
    const nonce = sanitizeNonce(String(rec.nonce ?? ''));
    const scriptUri = String(rec.scriptUri ?? '');
    const styleUri = String(rec.styleUri ?? '');

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
  <title>Symbols</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body>
  <div id="symbols-live" class="symbols-live" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="symbols-root" class="symbols-root" data-axis-symbols-host="1"></div>
  <script nonce="${safeNonce}" src="${safeScript}"></script>
</body>
</html>
`;
  } catch {
    return FALLBACK_HTML;
  }
}

export { escapeHtmlAttr, htmlHasInlineScript };

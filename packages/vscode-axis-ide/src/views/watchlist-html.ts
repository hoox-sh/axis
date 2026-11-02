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

/** Inputs for Watchlist studio webview HTML (URIs already asWebviewUri). */
export interface WatchlistHtmlOptions {
  /** `webview.cspSource` — never hard-code resource schemes here. */
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  bodyClass: string;
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Watchlist</title>
</head>
<body>
  <div id="watchlist-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Watchlist sidebar webview.
 * Same matrix as plugins: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildWatchlistWebviewHtml(opts?: WatchlistHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as WatchlistHtmlOptions)
        : ({} as WatchlistHtmlOptions);
    const cspSource = String(rec.cspSource ?? '');
    const scriptUri = String(rec.scriptUri ?? '');
    const styleUri = String(rec.styleUri ?? '');
    const bodyClass = String(rec.bodyClass ?? 'vscode-dark');

    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `script-src ${cspSource}`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `img-src ${cspSource} data: blob:`,
      "connect-src 'none'",
    ].join('; ');

    const safeCsp = escapeHtmlAttr(csp);
    const safeScript = escapeHtmlAttr(scriptUri);
    const safeStyle = escapeHtmlAttr(styleUri);
    const safeClass = bodyClass.replace(/[^a-zA-Z0-9_-]/g, '');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${safeCsp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Watchlist</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}">
  <div id="watchlist-root" class="watchlist-root" data-axis-watchlist-host="1">
    <header class="watchlist-header">
      <div class="watchlist-header__title">
        <svg class="watchlist-mark" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M2 3.5h12v1.2H2zm0 4h8v1.2H2zm0 4h10v1.2H2z"/>
        </svg>
        <h1 class="watchlist-title">Watchlist</h1>
      </div>
      <p class="watchlist-header__meta" id="watchlist-count">0 symbols</p>
      <p class="watchlist-header__meta" id="watchlist-selected">No symbol selected</p>
      <p class="watchlist-price" id="watchlist-price">—</p>
      <span class="watchlist-badge" id="watchlist-badge" hidden>placeholder</span>
    </header>
    <form id="watchlist-add-form" class="watchlist-add" autocomplete="off">
      <label class="watchlist-add__label" for="watchlist-symbol-input">Add symbol</label>
      <input id="watchlist-symbol-input" class="watchlist-input" type="text" placeholder="BTCUSDT" spellcheck="false" />
      <button type="submit" id="watchlist-add" class="watchlist-btn watchlist-btn--primary">Add</button>
    </form>
    <p class="watchlist-empty" id="watchlist-empty">Add a ticker such as BTCUSDT. The status bar still follows the selected symbol.</p>
    <ul id="watchlist-rows" class="watchlist-rows"></ul>
    <div id="watchlist-live" class="watchlist-live" aria-live="polite" aria-atomic="true"></div>
  </div>
  <script src="${safeScript}"></script>
</body>
</html>
`;
  } catch {
    return FALLBACK_HTML;
  }
}

export { escapeHtmlAttr, htmlHasInlineScript };

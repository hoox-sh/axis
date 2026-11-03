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
import { SCRIPTS_EMPTY_RUN } from './scripts-messages';

/** Inputs for Scripts studio webview HTML (URIs already asWebviewUri). */
export interface ScriptsHtmlOptions {
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
  <title>Scripts</title>
</head>
<body>
  <div id="scripts-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Scripts sidebar webview (`axis.indicators`).
 * Same matrix as plugins: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildScriptsWebviewHtml(opts?: ScriptsHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as ScriptsHtmlOptions)
        : ({} as ScriptsHtmlOptions);
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
  <title>Scripts</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}" data-axis-scripts-kind="scripts">
  <div id="scripts-root" class="scripts-root" data-axis-scripts-host="1">
    <header class="scripts-header">
      <h1 class="scripts-title">Scripts</h1>
    </header>
    <section class="scripts-card" aria-labelledby="scripts-last-heading">
      <h2 class="scripts-card__title" id="scripts-last-heading">Last run</h2>
      <p class="scripts-empty" id="scripts-empty">${SCRIPTS_EMPTY_RUN}</p>
      <dl class="scripts-dl" id="scripts-last" hidden>
        <dt>Script</dt><dd id="scripts-title"></dd>
        <dt>Symbol</dt><dd id="scripts-symbol"></dd>
        <dt>Interval</dt><dd id="scripts-interval"></dd>
        <dt>Mode</dt><dd id="scripts-mode"></dd>
        <dt>Status</dt><dd id="scripts-status"></dd>
        <dt id="scripts-error-label">Error</dt><dd id="scripts-error"></dd>
        <dt>When</dt><dd id="scripts-at"></dd>
        <dt id="scripts-epoch-label">Epoch</dt><dd id="scripts-epoch"></dd>
      </dl>
      <button type="button" class="scripts-btn" id="scripts-run">
        <svg class="scripts-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M4 2.5v11l10-5.5L4 2.5z"/>
        </svg>
        Run
      </button>
    </section>
    <section class="scripts-card" aria-labelledby="scripts-chart-heading">
      <h2 class="scripts-card__title" id="scripts-chart-heading">Chart</h2>
      <p class="scripts-card__copy">Chart beside the editor.</p>
      <button type="button" class="scripts-btn" id="scripts-open-chart">
        <svg class="scripts-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M2 13V3h2v8h10v2H2zm3-3 2.2-3 1.8 2.2L12 5l2 1.2-4.2 5.2-2-2.4L7 11 5 8.2V10z"/>
        </svg>
        Open chart
      </button>
    </section>
    <section class="scripts-card" aria-labelledby="scripts-suggest-heading">
      <h2 class="scripts-card__title" id="scripts-suggest-heading">Suggestions</h2>
      <ul class="scripts-list" id="scripts-suggestions"></ul>
    </section>
    <p class="scripts-live" id="scripts-live" aria-live="polite"></p>
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

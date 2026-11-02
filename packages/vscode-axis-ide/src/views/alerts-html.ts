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

/** Inputs for Alerts studio webview HTML (URIs already asWebviewUri). */
export interface AlertsHtmlOptions {
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
  <title>Alerts</title>
</head>
<body>
  <div id="alerts-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Alerts sidebar webview.
 * Same matrix as plugins: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildAlertsWebviewHtml(opts?: AlertsHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as AlertsHtmlOptions)
        : ({} as AlertsHtmlOptions);
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
  <title>Alerts</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}">
  <div id="alerts-root" class="alerts-root" data-axis-alerts-host="1">
    <header class="alerts-header">
      <div class="alerts-header__brand">
        <svg class="alerts-logo" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M8 1.75a.75.75 0 0 1 .75.75v.41A4.5 4.5 0 0 1 12.5 7.25v2.1l.9 1.35a.75.75 0 0 1-.62 1.15H3.22a.75.75 0 0 1-.62-1.15l.9-1.35v-2.1A4.5 4.5 0 0 1 7.25 2.91V2.5A.75.75 0 0 1 8 1.75zM6.5 12.75a1.5 1.5 0 0 0 3 0h-3z"/>
        </svg>
        <h1 class="alerts-title">Alerts</h1>
      </div>
      <p id="alerts-summary" class="alerts-summary" aria-live="polite" aria-atomic="true">0 alerts, 0 enabled</p>
    </header>
    <div class="alerts-form">
      <label class="alerts-field" for="alerts-title">Title
        <input id="alerts-title" name="title" type="text" placeholder="Alert title" autocomplete="off" />
      </label>
      <label class="alerts-field" for="alerts-condition">Condition
        <input id="alerts-condition" name="condition" type="text" placeholder="Optional condition" autocomplete="off" />
      </label>
      <button type="button" id="alerts-add" data-action="add">Add</button>
    </div>
    <p id="alerts-live" class="alerts-live" aria-live="polite" aria-atomic="true"></p>
    <p id="alerts-empty" class="alerts-empty">Add a title and an optional condition, then press Add. This is the IDE list, not the full PWA alert engine.</p>
    <ul id="alerts-list" class="alerts-list" aria-label="Alerts" hidden></ul>
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

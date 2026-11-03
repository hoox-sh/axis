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

/** Inputs for Workers studio webview HTML (URIs already asWebviewUri). */
export interface WorkersHtmlOptions {
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
  <title>AXIS Workers</title>
</head>
<body>
  <div id="workers-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Workers sidebar webview.
 * Same matrix as plugins: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildWorkersWebviewHtml(opts?: WorkersHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as WorkersHtmlOptions)
        : ({} as WorkersHtmlOptions);
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
  <title>AXIS Workers</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}" data-axis-workers-kind="workers">
  <div id="workers-root" class="workers-root" data-axis-workers-host="1">
    <header class="workers-root__header">
      <h1 class="workers-root__title">
        <svg class="workers-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"></rect>
          <path d="M5 8h6M8 5.5v5" fill="none" stroke="currentColor" stroke-width="1.2"></path>
        </svg>
        Workers
      </h1>
      <p class="workers-phase" id="workers-phase">Idle — not probed</p>
      <p class="workers-counts" id="workers-counts">0 healthy · 0 degraded · 0 down · 0 unknown</p>
      <button type="button" class="workers-btn" id="workers-probe-all">Probe all</button>
      <p class="workers-live" id="workers-live" aria-live="polite"></p>
    </header>
    <div id="workers-cards" class="workers-cards"></div>
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

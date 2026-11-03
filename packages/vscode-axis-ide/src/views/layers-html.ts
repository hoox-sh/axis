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

/** Inputs for Layers studio webview HTML (URIs already asWebviewUri). */
export interface LayersHtmlOptions {
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
  <title>Layers</title>
</head>
<body>
  <div id="layers-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Layers sidebar webview.
 * Same matrix as plugins: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildLayersWebviewHtml(opts?: LayersHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as LayersHtmlOptions)
        : ({} as LayersHtmlOptions);
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
  <title>Layers</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}">
  <div id="layers-root" class="layers-root" data-axis-layers-host="1">
    <header class="layers-header">
      <h1 id="layers-title" class="layers-title">Layers</h1>
      <p id="layers-summary" class="layers-summary">0 items · no chart open</p>
      <button type="button" id="layers-open-chart" class="layers-open">Open chart</button>
    </header>
    <p id="layers-live" class="layers-live" aria-live="polite" aria-atomic="true"></p>
    <div id="layers-sections" class="layers-sections"></div>
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

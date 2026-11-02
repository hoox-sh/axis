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

export type ResultsPanelKind = 'results' | 'strategy';

/** Inputs for Results / Strategy webview HTML (URIs already asWebviewUri). */
export interface ResultsHtmlOptions {
  /** `webview.cspSource` — never hard-code resource schemes here. */
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  bodyClass: string;
  /** Which panel shell to render — shared Vite bundle. */
  kind: ResultsPanelKind;
}

/**
 * Build CSP + HTML for Results / Strategy panel webviews.
 * Same matrix as chart: cspSource scripts, no inline script, connect-src none.
 */
export function buildResultsWebviewHtml(opts: ResultsHtmlOptions): string {
  const cspSource = String(opts.cspSource ?? '');
  const scriptUri = String(opts.scriptUri ?? '');
  const styleUri = String(opts.styleUri ?? '');
  const bodyClass = String(opts.bodyClass ?? 'vscode-dark');
  const kind: ResultsPanelKind = opts.kind === 'strategy' ? 'strategy' : 'results';

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
  const title = kind === 'strategy' ? 'AXIS Strategy' : 'AXIS Results';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${safeCsp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}" data-axis-results-kind="${kind}">
  <div id="results-root" class="results-root" data-axis-results-host="1" data-kind="${kind}">
    <header class="results-root__header">
      <h1 class="results-root__title">${kind === 'strategy' ? 'Strategy' : 'Results'}</h1>
      <p class="results-root__focus" id="results-focus">No run focused</p>
    </header>
    <pre class="results-root__body" id="results-body" hidden></pre>
    <p class="results-root__empty" id="results-empty">Run a Pine Script™ to see results here.</p>
  </div>
  <script src="${safeScript}"></script>
</body>
</html>
`;
}

export { escapeHtmlAttr, htmlHasInlineScript };

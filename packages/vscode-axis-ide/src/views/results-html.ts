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
  const heading = kind === 'strategy' ? 'Strategy' : 'Results';

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
    <div id="results-live" class="results-live" aria-live="polite" aria-atomic="true"></div>
    <header class="results-header" id="results-header">
      <div class="results-header__sticky">
        <div class="results-header__top">
          <h1 class="results-header__title" id="results-title">${heading}</h1>
          <span class="results-status results-status--idle" id="results-status" data-status="idle" role="status" aria-live="polite" aria-atomic="true" aria-label="Status: Idle">Idle</span>
          <span class="results-time" id="results-time" hidden></span>
          <div class="results-actions">
            <button type="button" class="results-icon-btn" id="results-copy-id" data-action="copyId" hidden title="Copy run id" aria-label="Copy run id">Copy id</button>
            <button type="button" class="results-icon-btn" id="results-focus-profiler" data-action="focusProfiler" hidden title="Open Profiler" aria-label="Open Profiler">Profiler</button>
            <button type="button" class="results-icon-btn" id="results-focus-logs" data-action="focusLogs" hidden title="Open Logs" aria-label="Open Logs">Logs</button>
          </div>
        </div>
        <div class="results-meta" id="results-meta" hidden></div>
        <p class="results-header__focus" id="results-focus">No run focused</p>
        <div class="results-search-wrap" id="results-search-wrap" hidden>
          <input class="results-search" id="results-search" type="search" placeholder="Filter rows (/)" aria-label="Filter rows" autocomplete="off" spellcheck="false" />
        </div>
      </div>
    </header>
    <div class="results-body">
      <section class="results-card" id="results-card" hidden>
        <div class="results-kpis" id="results-kpis" hidden></div>
        <dl class="results-rows" id="results-rows"></dl>
        <div class="results-strategy" id="results-strategy" hidden>
          <h2 class="results-strategy__title" id="results-strategy-title">Strategy</h2>
          <p class="results-strategy__empty" id="results-strategy-empty" hidden>This run has no strategy report</p>
          <dl class="results-rows results-rows--strategy" id="results-strategy-rows"></dl>
        </div>
      </section>
      <div class="results-empty" id="results-empty">
        <p class="results-empty__title" id="results-empty-title">No run yet</p>
        <p class="results-empty__hint" id="results-empty-hint">Run a Pine script with Ctrl/Cmd+Enter</p>
      </div>
    </div>
  </div>
  <script src="${safeScript}"></script>
</body>
</html>
`;
}

export { escapeHtmlAttr, htmlHasInlineScript };

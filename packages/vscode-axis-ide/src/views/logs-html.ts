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
import { LOGS_EMPTY } from './logs-messages';

/** Inputs for Logs panel webview HTML (URIs already asWebviewUri). */
export interface LogsHtmlOptions {
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
  <title>AXIS Logs</title>
</head>
<body>
  <div id="logs-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Logs panel webview.
 * Same matrix as plugins: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildLogsWebviewHtml(opts?: LogsHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as LogsHtmlOptions)
        : ({} as LogsHtmlOptions);
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
    const emptyCopy = escapeHtmlAttr(LOGS_EMPTY);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${safeCsp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AXIS Logs</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}" data-axis-logs-kind="logs">
  <div id="logs-live" class="logs-live" role="status" aria-live="polite" aria-atomic="true"></div>
  <section id="logs-root" class="logs-root" data-axis-logs-host="1" aria-label="Script logs">
    <header class="logs-header">
      <div class="logs-header__top">
        <h1 class="logs-title">Logs</h1>
        <div class="logs-run-wrap">
          <span id="logs-run" class="logs-run" title="Run id">No run</span>
          <button type="button" id="logs-run-copy" class="logs-run-copy" hidden title="Copy run id" aria-label="Copy run id">Copy</button>
        </div>
        <span id="logs-status" class="logs-status" data-status="" hidden></span>
        <span id="logs-count" class="logs-count" aria-live="polite">0 / 0</span>
      </div>
      <div class="logs-toolbar">
        <div class="logs-filters" role="group" aria-label="Log level filter">
          <button type="button" class="logs-chip" data-level="all" aria-pressed="true">All <span class="logs-chip-count" data-count-for="all">0</span></button>
          <button type="button" class="logs-chip" data-level="error" aria-pressed="false">Error <span class="logs-chip-count" data-count-for="error">0</span></button>
          <button type="button" class="logs-chip" data-level="warning" aria-pressed="false">Warning <span class="logs-chip-count" data-count-for="warning">0</span></button>
          <button type="button" class="logs-chip" data-level="info" aria-pressed="false">Info <span class="logs-chip-count" data-count-for="info">0</span></button>
          <button type="button" class="logs-chip" data-level="debug" aria-pressed="false">Debug <span class="logs-chip-count" data-count-for="debug">0</span></button>
        </div>
        <label class="logs-search-wrap" for="logs-search">
          <span class="logs-search-label">Search</span>
          <input id="logs-search" class="logs-search" type="search" name="logs-search" placeholder="Filter messages" aria-label="Filter log messages" autocomplete="off" spellcheck="false" />
        </label>
      </div>
    </header>
    <p id="logs-empty" class="logs-empty">${emptyCopy}</p>
    <ol id="logs-list" class="logs-list" tabindex="0" role="listbox" aria-label="Log lines" aria-activedescendant=""></ol>
  </section>
  <script src="${safeScript}"></script>
</body>
</html>
`;
  } catch {
    return FALLBACK_HTML;
  }
}

export { escapeHtmlAttr, htmlHasInlineScript };

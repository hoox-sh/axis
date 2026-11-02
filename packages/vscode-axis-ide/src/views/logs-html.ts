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
  <section id="logs-root" class="logs-root" data-axis-logs-host="1" aria-label="Script logs">
    <header class="logs-header">
      <h1 class="logs-title">Logs</h1>
      <p class="logs-meta">
        <span id="logs-run">No run</span>
        <span id="logs-status"></span>
        <span id="logs-count">0</span>
      </p>
      <div class="logs-filters" role="group" aria-label="Log level filter">
        <button type="button" class="logs-chip" data-level="all" aria-pressed="true">All</button>
        <button type="button" class="logs-chip" data-level="error" aria-pressed="false">Error</button>
        <button type="button" class="logs-chip" data-level="warning" aria-pressed="false">Warning</button>
        <button type="button" class="logs-chip" data-level="info" aria-pressed="false">Info</button>
      </div>
    </header>
    <p id="logs-empty" class="logs-empty">No log lines for the last run</p>
    <ol id="logs-list" class="logs-list"></ol>
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

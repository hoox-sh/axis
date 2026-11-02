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

/** Inputs for Profiler panel webview HTML (URIs already asWebviewUri). */
export interface ProfilerHtmlOptions {
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
  <title>AXIS Profiler</title>
</head>
<body>
  <div id="profiler-root"></div>
</body>
</html>
`;

/**
 * Build CSP + HTML for the Profiler panel webview.
 * Same matrix as results: cspSource scripts, no inline script, connect-src none.
 * Never throws.
 */
export function buildProfilerWebviewHtml(opts?: ProfilerHtmlOptions | null): string {
  try {
    const rec =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as ProfilerHtmlOptions)
        : ({} as ProfilerHtmlOptions);
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
  <title>AXIS Profiler</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}" data-axis-profiler-kind="profiler">
  <div id="profiler-root" class="profiler-root" data-axis-profiler-host="1">
    <div id="profiler-live" class="profiler-live" aria-live="polite" aria-atomic="true"></div>
    <header class="profiler-root__header" id="profiler-header">
      <div class="profiler-root__header-row">
        <h1 class="profiler-root__title">Profiler</h1>
        <button type="button" class="profiler-copy" id="profiler-copy" hidden title="Copy run id" aria-label="Copy run id">Copy id</button>
      </div>
      <p class="profiler-root__focus" id="profiler-focus">No run yet</p>
    </header>
    <div class="profiler-body" id="profiler-body">
      <p class="profiler-ms" id="profiler-ms">—<span class="profiler-ms__unit">ms</span></p>
      <span class="profiler-chip" id="profiler-status" hidden></span>
      <div class="profiler-bar" id="profiler-bar" hidden aria-hidden="true">
        <div class="profiler-bar__fill" id="profiler-bar-fill"></div>
      </div>
      <dl class="profiler-dl" id="profiler-dl" hidden>
        <dt>engine</dt><dd id="profiler-engine"></dd>
        <dt>seriesKey</dt><dd id="profiler-series-key"></dd>
        <dt>plots</dt><dd id="profiler-plots"></dd>
        <dt>series</dt><dd id="profiler-series"></dd>
      </dl>
      <section class="profiler-phases" id="profiler-phases" hidden aria-label="Phases">
        <h2 class="profiler-section__title">Phases</h2>
        <ul class="profiler-phases__list" id="profiler-phases-list"></ul>
      </section>
      <section class="profiler-hot" id="profiler-hot" hidden aria-label="Hot lines">
        <h2 class="profiler-section__title">Hot lines</h2>
        <ul class="profiler-hot__list" id="profiler-hot-list"></ul>
      </section>
      <p class="profiler-root__empty" id="profiler-empty">Run a script to see timing. Line costs appear when the engine returns per-line profile data.</p>
    </div>
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

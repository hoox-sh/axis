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

/** Inputs for the chart webview HTML shell (URIs already passed through asWebviewUri). */
export interface ChartHtmlOptions {
  /** `webview.cspSource` — never hard-code `vscode-resource:` / `https:` here. */
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  /** VS Code theme body class (`vscode-dark` / `vscode-light` / high-contrast variants). */
  bodyClass: string;
}

/** Escape a value for use inside a double-quoted HTML attribute. */
export function escapeHtmlAttr(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build CSP + HTML for the chart custom editor webview.
 * No inline scripts (KD-6 / design CSP matrix). Styles may use 'unsafe-inline' for theme vars.
 */
export function buildChartWebviewHtml(opts: ChartHtmlOptions): string {
  const cspSource = String(opts.cspSource ?? '');
  const scriptUri = String(opts.scriptUri ?? '');
  const styleUri = String(opts.styleUri ?? '');
  const bodyClass = String(opts.bodyClass ?? 'vscode-dark');

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `script-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    // blob: reserved for future canvas/LWC exports (design CSP matrix).
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
  <title>AXIS Chart</title>
  <link rel="stylesheet" href="${safeStyle}" />
</head>
<body class="${safeClass}">
  <div id="chart-host" class="chart-host" data-axis-chart-host="1" role="presentation">
    <p class="chart-host__placeholder">AXIS chart host</p>
  </div>
  <script src="${safeScript}"></script>
</body>
</html>
`;
}

/**
 * True when HTML has a script tag without src= (inline body or event-handler style).
 * `src=`-only tags are allowed.
 */
export function htmlHasInlineScript(html: string): boolean {
  const re = /<script\b([^>]*)>/gi;
  let match: RegExpExecArray | null = re.exec(html);
  while (match) {
    const attrs = match[1] ?? '';
    if (!/\bsrc\s*=/i.test(attrs)) return true;
    match = re.exec(html);
  }
  return false;
}

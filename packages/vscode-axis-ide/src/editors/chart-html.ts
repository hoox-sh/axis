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
  /**
   * When true, widen chart CSP for optional Pyodide (`axis.engine.allowPyodide`).
   * Default false — paint-only matrix unchanged. See `docs/csp-matrix.md`.
   */
  allowPyodide?: boolean;
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
 * Chart CSP directives (KD-6). Default paint-only; optional Pyodide widen adds
 * `'wasm-unsafe-eval'` + `worker-src blob: ${cspSource}` when `allowPyodide`.
 */
export function buildChartCspDirectives(cspSource: string, allowPyodide = false): string[] {
  const src = String(cspSource ?? '');
  const scriptSrc = allowPyodide
    ? `script-src ${src} 'wasm-unsafe-eval'`
    : `script-src ${src}`;
  const directives = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    scriptSrc,
    `style-src ${src} 'unsafe-inline'`,
    // blob: reserved for canvas/LWC exports (design CSP matrix).
    `img-src ${src} data: blob:`,
    "connect-src 'none'",
  ];
  if (allowPyodide) {
    directives.push(`worker-src blob: ${src}`);
  }
  return directives;
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
  const allowPyodide = opts.allowPyodide === true;

  const csp = buildChartCspDirectives(cspSource, allowPyodide).join('; ');

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
  <div id="chart-shell" class="chart-shell" data-axis-chart-shell="1">
    <div id="chart-toolbar" class="chart-toolbar" role="toolbar" aria-label="Drawing tools">
      <svg id="chart-mark" class="chart-toolbar__mark" width="12" height="12" viewBox="0 0 1505.3611 1330.7858" aria-hidden="true" focusable="false">
        <g transform="matrix(2.2062294,0,0,2.2117592,-1506.9584,-1032.9513)" fill="currentColor">
          <path d="m 1024.04,675.876 c 9.61,8.797 21.53,21.439 30.93,30.842 l 60.92,60.911 64.67,-64.663 119.79,-0.021 65.02,64.909 -65.07,65.008 -119.48,0.035 c -21.7,-21.207 -43.47,-43.36 -64.98,-64.832 l -91.24,91.236 c -5.86,-2.803 -80.868,-79.926 -92.266,-91.298 l -64.893,64.883 -119.277,-0.045 -65.117,-65.099 64.831,-64.765 119.814,-0.031 64.627,64.595 z"/>
          <path d="m 1232.94,467.045 92.02,10e-4 v 91.811 c -26.49,27.819 -56.93,57.065 -84.22,84.402 -24.41,1.422 -66.03,0.153 -92.08,0.169 l -0.01,-92.172 z"/>
          <path d="m 807.882,892.19 91.983,-0.005 -0.021,91.784 c -27.549,28.221 -56.511,56.651 -84.537,84.501 -29.899,0.53 -61.821,0.03 -91.855,0.03 l -0.006,-92.147 c 27.99,-28.21 56.136,-56.265 84.436,-84.163 z"/>
          <path d="m 723.569,467.027 91.556,0.002 c 28.133,26.948 57.059,56.938 84.669,84.614 l 0.052,91.703 -92.108,0.075 -84.298,-84.317 z"/>
          <path d="m 1148.68,892.158 91.71,-0.025 84.61,84.679 -0.01,91.668 c -30.37,0.36 -61.52,0.06 -91.94,0.09 l -84.38,-84.377 z"/>
        </g>
      </svg>
      <button type="button" id="tool-trendline" class="chart-toolbar__btn" data-tool="trendline" aria-pressed="false" title="Trendline">Trendline</button>
      <div id="chart-hud" class="chart-plugins" aria-label="Chart HUD">
        <span id="chart-plot-count" class="chart-plugins__chip" hidden></span>
        <div id="chart-plugins" class="chart-plugins" hidden aria-label="Active plugins"></div>
      </div>
    </div>
    <div id="chart-stage" class="chart-stage">
      <div id="chart-host" class="chart-host" data-axis-chart-host="1" role="presentation">
        <p class="chart-host__placeholder">AXIS chart host</p>
      </div>
      <svg id="drawing-overlay" class="drawing-overlay" aria-hidden="true"></svg>
    </div>
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

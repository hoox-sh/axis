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

import { describe, expect, test } from 'bun:test';
import { buildChartWebviewHtml, escapeHtmlAttr, htmlHasInlineScript } from './chart-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('chart CSP HTML builder', () => {
  test('embeds cspSource in CSP directives and has no inline script', () => {
    const html = buildChartWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: `${CSP_SOURCE}/main.js`,
      styleUri: `${CSP_SOURCE}/main.css`,
      bodyClass: 'vscode-dark',
    });

    expect(html).toContain(`script-src ${CSP_SOURCE}`);
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain('script-src *');
    expect(html).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(html).toContain(`img-src ${CSP_SOURCE} data: blob:`);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain(`src="${CSP_SOURCE}/main.js"`);
    expect(html).toContain(`href="${CSP_SOURCE}/main.css"`);
    expect(html).toContain('id="chart-host"');
    expect(html).toContain('class="vscode-dark"');
    expect(htmlHasInlineScript(html)).toBe(false);
    expect(html.includes('<script>')).toBe(false);
  });

  test('escapes URI attribute characters', () => {
    const html = buildChartWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
      bodyClass: 'vscode-dark',
    });
    const escapedScript = escapeHtmlAttr('https://x.test/a"onclick=alert(1)');
    expect(html).toContain(`src="${escapedScript}"`);
    // Quote is escaped so the URI cannot break out of the attribute.
    expect(escapedScript).toContain('&quot;');
    expect(html).not.toContain('src="https://x.test/a"onclick');
    expect(html).toContain('&lt;script&gt;');
  });

  test('strips unsafe body class characters', () => {
    const html = buildChartWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-dark"><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('class="vscode-darkscriptalert1script"');
  });

  test('htmlHasInlineScript detects body-bearing tags but allows src scripts', () => {
    expect(htmlHasInlineScript('<script>alert(1)</script>')).toBe(true);
    expect(htmlHasInlineScript('<script type="text/javascript">x()</script>')).toBe(true);
    expect(htmlHasInlineScript('<script src="x.js"></script>')).toBe(false);
    expect(htmlHasInlineScript('<script type="module" src="x.js"></script>')).toBe(false);
  });
});

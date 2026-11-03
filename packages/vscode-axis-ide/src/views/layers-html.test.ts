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
import {
  buildLayersWebviewHtml,
  escapeHtmlAttr,
  htmlHasInlineScript,
} from './layers-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('layers CSP HTML builder', () => {
  test('embeds cspSource, connect-src none, no inline script', () => {
    const html = buildLayersWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: `${CSP_SOURCE}/main.js`,
      styleUri: `${CSP_SOURCE}/main.css`,
      bodyClass: 'vscode-dark',
    });
    expect(html).toContain(`script-src ${CSP_SOURCE}`);
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(html).toContain(`img-src ${CSP_SOURCE} data: blob:`);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain('<title>Layers</title>');
    expect(html).toContain('id="layers-root"');
    expect(html).toContain('data-axis-layers-host="1"');
    expect(html).toContain('id="layers-summary"');
    expect(html).toContain('no chart open');
    expect(html).toContain('id="layers-open-chart"');
    expect(html).toContain('Open chart');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="layers-sections"');
    expect(html).toContain('class="vscode-dark"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attribute characters and sanitizes body class', () => {
    const html = buildLayersWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
      bodyClass: 'vscode-dark"><script>',
    });
    expect(html).toContain(escapeHtmlAttr('https://x.test/a"onclick=alert(1)'));
    expect(html).not.toContain('src="https://x.test/a"onclick');
    expect(html).toContain('class="vscode-darkscript"');
  });

  test('defaults bodyClass to vscode-dark when omitted', () => {
    const html = buildLayersWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'a.js',
      styleUri: 'a.css',
    } as never);
    expect(html).toContain('class="vscode-dark"');
  });

  test('never throws on nullish / array / hostile getters', () => {
    expect(buildLayersWebviewHtml(undefined)).toContain('id="layers-root"');
    expect(buildLayersWebviewHtml(null)).toContain('id="layers-root"');
    expect(buildLayersWebviewHtml([] as never)).toContain('id="layers-root"');
    expect(buildLayersWebviewHtml(1 as never)).toContain('id="layers-root"');
    const html = buildLayersWebviewHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-light',
    });
    expect(html).toContain('id="layers-root"');
    expect(html).toContain('<title>Layers</title>');
    expect(htmlHasInlineScript(html)).toBe(false);
  });
});

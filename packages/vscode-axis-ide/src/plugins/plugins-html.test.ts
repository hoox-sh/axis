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
  buildPluginsWebviewHtml,
  escapeHtmlAttr,
  htmlHasInlineScript,
} from './plugins-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('plugins CSP HTML builder', () => {
  test('embeds cspSource, connect-src none, no inline script', () => {
    const html = buildPluginsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: `${CSP_SOURCE}/main.js`,
      styleUri: `${CSP_SOURCE}/main.css`,
      bodyClass: 'vscode-dark',
    });
    expect(html).toContain(`script-src ${CSP_SOURCE}`);
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain('<title>Plugins</title>');
    expect(html).toContain('id="plugins-root"');
    expect(html).toContain('class="vscode-dark"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attribute characters and sanitizes body class', () => {
    const html = buildPluginsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
      bodyClass: 'vscode-dark"><script>',
    });
    expect(html).toContain(escapeHtmlAttr('https://x.test/a"onclick=alert(1)'));
    expect(html).not.toContain('src="https://x.test/a"onclick');
    expect(html).toContain('class="vscode-darkscript"');
  });

  test('never throws on nullish / array / hostile getters', () => {
    expect(buildPluginsWebviewHtml(undefined)).toContain('id="plugins-root"');
    expect(buildPluginsWebviewHtml(null)).toContain('id="plugins-root"');
    expect(buildPluginsWebviewHtml([] as never)).toContain('id="plugins-root"');
    const html = buildPluginsWebviewHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-light',
    });
    expect(html).toContain('id="plugins-root"');
    expect(html).toContain('<title>Plugins</title>');
  });
});

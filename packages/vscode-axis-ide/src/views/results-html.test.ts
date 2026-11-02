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
  buildResultsWebviewHtml,
  escapeHtmlAttr,
  htmlHasInlineScript,
} from './results-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('results CSP HTML builder', () => {
  test('embeds cspSource, connect-src none, no inline script (results)', () => {
    const html = buildResultsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: `${CSP_SOURCE}/main.js`,
      styleUri: `${CSP_SOURCE}/main.css`,
      bodyClass: 'vscode-dark',
      kind: 'results',
    });
    expect(html).toContain(`script-src ${CSP_SOURCE}`);
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('data-axis-results-kind="results"');
    expect(html).toContain('id="results-root"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('strategy kind shares CSP matrix', () => {
    const html = buildResultsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-light',
      kind: 'strategy',
    });
    expect(html).toContain('data-axis-results-kind="strategy"');
    expect(html).toContain('AXIS Strategy');
    expect(html).toContain("connect-src 'none'");
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attribute characters', () => {
    const html = buildResultsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
      bodyClass: 'vscode-dark',
      kind: 'results',
    });
    expect(html).toContain(escapeHtmlAttr('https://x.test/a"onclick=alert(1)'));
    expect(html).not.toContain('src="https://x.test/a"onclick');
  });
});

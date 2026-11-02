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
import { buildLogsWebviewHtml, escapeHtmlAttr, htmlHasInlineScript } from './logs-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('logs CSP HTML builder', () => {
  test('embeds cspSource, connect-src none, no inline script', () => {
    const html = buildLogsWebviewHtml({
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
    expect(html).toContain('img-src');
    expect(html).toContain('data-axis-logs-kind="logs"');
    expect(html).toContain('id="logs-root"');
    expect(html).toContain('id="logs-run"');
    expect(html).toContain('id="logs-run-copy"');
    expect(html).toContain('id="logs-status"');
    expect(html).toContain('id="logs-count"');
    expect(html).toContain('id="logs-search"');
    expect(html).toContain('id="logs-live"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Log level filter"');
    expect(html).toContain('data-level="all"');
    expect(html).toContain('data-level="error"');
    expect(html).toContain('data-level="warning"');
    expect(html).toContain('data-level="info"');
    expect(html).toContain('data-level="debug"');
    expect(html).toContain('data-count-for="all"');
    expect(html).toContain('No log lines for the last run');
    expect(html).toContain('AXIS Logs');
    expect(html).toContain('class="vscode-dark"');
    expect(html).toContain('class="logs-header"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attribute characters and sanitizes body class', () => {
    const html = buildLogsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
      bodyClass: 'vscode-dark"><script>',
    });
    expect(html).toContain(escapeHtmlAttr('https://x.test/a"onclick=alert(1)'));
    expect(html).not.toContain('src="https://x.test/a"onclick');
    expect(html).toContain('class="vscode-darkscript"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('defaults bodyClass to vscode-dark when omitted', () => {
    const html = buildLogsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'a.js',
      styleUri: 'a.css',
    } as never);
    expect(html).toContain('class="vscode-dark"');
  });

  test('never throws on nullish / array / hostile getters', () => {
    expect(buildLogsWebviewHtml(undefined)).toContain('id="logs-root"');
    expect(buildLogsWebviewHtml(null)).toContain('id="logs-root"');
    expect(buildLogsWebviewHtml([] as never)).toContain('id="logs-root"');
    const html = buildLogsWebviewHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-light',
    });
    expect(html).toContain('id="logs-root"');
    expect(html).toContain('<title>AXIS Logs</title>');
    expect(html).not.toContain('Content-Security-Policy');
    expect(htmlHasInlineScript(html)).toBe(false);
  });
});

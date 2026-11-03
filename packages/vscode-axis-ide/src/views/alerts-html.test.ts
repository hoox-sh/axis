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
  buildAlertsWebviewHtml,
  escapeHtmlAttr,
  htmlHasInlineScript,
} from './alerts-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('alerts CSP HTML builder', () => {
  test('embeds cspSource, connect-src none, no inline script', () => {
    const html = buildAlertsWebviewHtml({
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
    expect(html).toContain(`img-src ${CSP_SOURCE} data: blob:`);
    expect(html).toContain('<title>Alerts</title>');
    expect(html).toContain('id="alerts-root"');
    expect(html).toContain('data-axis-alerts-host="1"');
    expect(html).toContain('id="alerts-summary"');
    expect(html).toContain('0 alerts, 0 enabled');
    expect(html).toContain('id="alerts-title"');
    expect(html).toContain('id="alerts-condition"');
    expect(html).toContain('id="alerts-add"');
    expect(html).toContain('type="button"');
    expect(html).toContain('id="alerts-list"');
    expect(html).toContain('id="alerts-empty"');
    expect(html).toContain('id="alerts-live"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('not the full PWA alert engine');
    expect(html).toContain('<svg');
    expect(html).toContain('class="vscode-dark"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('webview-ui-toolkit');
    expect(html).not.toContain('vscode-elements');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attribute characters and sanitizes body class', () => {
    const html = buildAlertsWebviewHtml({
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
    const html = buildAlertsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'a.js',
      styleUri: 'a.css',
    } as never);
    expect(html).toContain('class="vscode-dark"');
  });

  test('never throws on nullish / array / non-object / hostile getters', () => {
    expect(buildAlertsWebviewHtml(undefined)).toContain('id="alerts-root"');
    expect(buildAlertsWebviewHtml(null)).toContain('id="alerts-root"');
    expect(buildAlertsWebviewHtml([] as never)).toContain('id="alerts-root"');
    expect(buildAlertsWebviewHtml(1 as never)).toContain('id="alerts-root"');
    expect(buildAlertsWebviewHtml('nope' as never)).toContain('class="vscode-dark"');
    const html = buildAlertsWebviewHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-light',
    });
    expect(html).toContain('id="alerts-root"');
    expect(html).toContain('<title>Alerts</title>');
    expect(htmlHasInlineScript(html)).toBe(false);
  });
});

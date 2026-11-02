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
import { SCRIPTS_EMPTY_RUN } from './scripts-messages';
import {
  buildScriptsWebviewHtml,
  escapeHtmlAttr,
  htmlHasInlineScript,
} from './scripts-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('scripts CSP HTML builder', () => {
  test('embeds cspSource, connect-src none, no inline script', () => {
    const html = buildScriptsWebviewHtml({
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
    expect(html).toContain('<title>Scripts</title>');
    expect(html).toContain('data-axis-scripts-kind="scripts"');
    expect(html).toContain('id="scripts-root"');
    expect(html).toContain('id="scripts-run"');
    expect(html).toContain('id="scripts-open-chart"');
    expect(html).toContain('id="scripts-suggestions"');
    expect(html).toContain('id="scripts-live"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(SCRIPTS_EMPTY_RUN);
    expect(html).toContain('<svg');
    expect(html).toContain('class="vscode-dark"');
    expect(html).not.toContain('webview-ui-toolkit');
    expect(html).not.toContain('vscode-elements');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attribute characters and sanitizes body class', () => {
    const html = buildScriptsWebviewHtml({
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
    const html = buildScriptsWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: 'a.js',
      styleUri: 'a.css',
    } as never);
    expect(html).toContain('class="vscode-dark"');
    const emptyClass = buildScriptsWebviewHtml({
      cspSource: '',
      scriptUri: '',
      styleUri: '',
      bodyClass: '',
    });
    expect(emptyClass).toContain('class=""');
    expect(emptyClass).toContain('script-src ');
  });

  test('never throws on nullish / array / hostile getters', () => {
    expect(buildScriptsWebviewHtml(undefined)).toContain('id="scripts-root"');
    expect(buildScriptsWebviewHtml(null)).toContain('id="scripts-root"');
    expect(buildScriptsWebviewHtml([] as never)).toContain('id="scripts-root"');
    expect(buildScriptsWebviewHtml([] as never)).toContain(SCRIPTS_EMPTY_RUN);
    expect(buildScriptsWebviewHtml('nope' as never)).toContain('id="scripts-root"');
    const html = buildScriptsWebviewHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      scriptUri: 'a.js',
      styleUri: 'a.css',
      bodyClass: 'vscode-light',
    });
    expect(html).toContain('id="scripts-root"');
    expect(html).toContain('<title>Scripts</title>');
    expect(html).not.toContain('Content-Security-Policy');
    expect(htmlHasInlineScript(html)).toBe(false);
  });
});

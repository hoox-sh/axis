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
import { buildSymbolsWebviewHtml, escapeHtmlAttr, htmlHasInlineScript } from './symbols-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('buildSymbolsWebviewHtml', () => {
  test('nonce on script-src, plugins style-src, live region, and mount', () => {
    const nonce = 'Abc123+/=_-xyz';
    const html = buildSymbolsWebviewHtml({
      cspSource: CSP_SOURCE,
      nonce,
      scriptUri: `${CSP_SOURCE}/main.js`,
      styleUri: `${CSP_SOURCE}/main.css`,
    });
    expect(html).toContain(`script-src 'nonce-${nonce}' ${CSP_SOURCE}`);
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(html).not.toContain(`style-src 'nonce-${nonce}'`);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain(`img-src ${CSP_SOURCE} data: blob:`);
    expect(html).toContain('<title>Symbols</title>');
    expect(html).toContain('id="symbols-root"');
    expect(html).toContain('data-axis-symbols-host="1"');
    expect(html).toContain('id="symbols-live"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`src="${CSP_SOURCE}/main.js"`);
    expect(html).toContain(`href="${CSP_SOURCE}/main.css"`);
    expect(html).not.toContain('onclick=');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attributes and strips nonce characters that would break CSP', () => {
    const html = buildSymbolsWebviewHtml({
      cspSource: CSP_SOURCE,
      nonce: `ab c"def<script>`,
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
    });
    expect(html).toContain("script-src 'nonce-abcdefscript'");
    expect(html).toContain('nonce="abcdefscript"');
    expect(html).not.toContain('ab c"def');
    expect(html).toContain(escapeHtmlAttr('https://x.test/a"onclick=alert(1)'));
    expect(html).not.toContain('src="https://x.test/a"onclick');
    expect(html).toContain(escapeHtmlAttr('https://x.test/b<script>'));
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('empty fields still build a shell', () => {
    const html = buildSymbolsWebviewHtml({} as never);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'nonce-' ");
    expect(html).toContain("style-src  'unsafe-inline'");
    expect(html).toContain('id="symbols-root"');
    expect(html).toContain('id="symbols-live"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('nullish, arrays, and non-objects use the empty shell', () => {
    for (const opts of [undefined, null, [], 1, 'symbols'] as const) {
      const html = buildSymbolsWebviewHtml(opts as never);
      expect(html).toContain('id="symbols-root"');
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain('id="symbols-live"');
    }
  });

  test('hostile getters fall back without the failed URI', () => {
    const html = buildSymbolsWebviewHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      nonce: 'n',
      scriptUri: 'SECRET.js',
      styleUri: 'a.css',
    });
    expect(html).toContain('id="symbols-root"');
    expect(html).toContain('id="symbols-live"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<title>Symbols</title>');
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).not.toContain('SECRET.js');
    expect(htmlHasInlineScript(html)).toBe(false);

    expect(
      buildSymbolsWebviewHtml({
        cspSource: CSP_SOURCE,
        get nonce(): string {
          throw new Error('nonce');
        },
        scriptUri: 'a.js',
        styleUri: 'a.css',
      }),
    ).not.toContain('Content-Security-Policy');
    expect(
      buildSymbolsWebviewHtml({
        cspSource: CSP_SOURCE,
        nonce: 'n',
        get scriptUri(): string {
          throw new Error('script');
        },
        styleUri: 'a.css',
      }),
    ).not.toContain('a.css');
    expect(
      buildSymbolsWebviewHtml({
        cspSource: CSP_SOURCE,
        nonce: 'n',
        scriptUri: 'a.js',
        get styleUri(): string {
          throw new Error('css');
        },
      }),
    ).not.toContain('src="a.js"');
  });
});

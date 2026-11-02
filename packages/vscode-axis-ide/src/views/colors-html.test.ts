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
import { escapeHtmlAttr, getColorsHtml, htmlHasInlineScript } from './colors-html';

const CSP_SOURCE = 'https://csp.example.vscode-webview.test';

describe('getColorsHtml', () => {
  test('nonce on script-src, plugins style-src, empty state, and list', () => {
    const nonce = 'Abc123+/=_-xyz';
    const html = getColorsHtml({
      cspSource: CSP_SOURCE,
      nonce,
      scriptUri: `${CSP_SOURCE}/main.js`,
      styleUri: `${CSP_SOURCE}/main.css`,
      bodyClass: 'vscode-light',
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
    expect(html).toContain('<title>Colors</title>');
    expect(html).toContain('id="colors-root"');
    expect(html).toContain('data-axis-colors-host="1"');
    expect(html).toContain('data-axis-colors-kind="colors"');
    expect(html).toContain('id="colors-count"');
    expect(html).toContain('id="colors-source"');
    expect(html).toContain('id="colors-refresh"');
    expect(html).toContain('id="colors-search"');
    expect(html).toContain('class="colors-filters"');
    expect(html).toContain('data-kind="all"');
    expect(html).toContain('data-kind="hex"');
    expect(html).toContain('data-kind="named"');
    expect(html).toContain('data-kind="rgb-new"');
    expect(html).toContain('id="colors-empty"');
    expect(html).toContain('No colors in this script');
    expect(html).toContain('role="status"');
    expect(html).toContain('id="colors-list"');
    expect(html).toContain('aria-label="Colors in this script"');
    expect(html).toContain('class="vscode-light"');
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`src="${CSP_SOURCE}/main.js"`);
    expect(html).toContain(`href="${CSP_SOURCE}/main.css"`);
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('escapes URI attributes, strips nonce breakers, and sanitizes body class', () => {
    const html = getColorsHtml({
      cspSource: CSP_SOURCE,
      nonce: 'ab c"def<script>',
      scriptUri: 'https://x.test/a"onclick=alert(1)',
      styleUri: 'https://x.test/b<script>',
      bodyClass: 'vscode-dark"><script>',
    });
    expect(html).toContain("script-src 'nonce-abcdefscript'");
    expect(html).toContain('nonce="abcdefscript"');
    expect(html).not.toContain('ab c"def');
    expect(html).toContain(escapeHtmlAttr('https://x.test/a"onclick=alert(1)'));
    expect(html).not.toContain('src="https://x.test/a"onclick');
    expect(html).toContain(escapeHtmlAttr('https://x.test/b<script>'));
    expect(html).toContain('class="vscode-darkscript"');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('defaults body class and still builds a shell when fields are empty', () => {
    const html = getColorsHtml({} as never);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'nonce-' ");
    expect(html).toContain("style-src  'unsafe-inline'");
    expect(html).toContain('class="vscode-dark"');
    expect(html).toContain('id="colors-root"');
    expect(html).toContain('No colors in this script');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('nullish, arrays, and non-objects use the empty shell', () => {
    for (const opts of [undefined, null, [], 1, 'colors'] as const) {
      const html = getColorsHtml(opts as never);
      expect(html).toContain('id="colors-root"');
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain('No colors in this script');
      expect(html).toContain('class="vscode-dark"');
    }
  });

  test('never throws on hostile getters and omits the failed URI', () => {
    const html = getColorsHtml({
      get cspSource(): string {
        throw new Error('csp');
      },
      nonce: 'n',
      scriptUri: 'SECRET.js',
      styleUri: 'a.css',
    });
    expect(html).toContain('id="colors-root"');
    expect(html).toContain('No colors in this script');
    expect(html).toContain('aria-label="Colors in this script"');
    expect(html).toContain('<title>Colors</title>');
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).not.toContain('SECRET.js');
    expect(htmlHasInlineScript(html)).toBe(false);
  });

  test('hostile nonce, script, style, and body getters fall back', () => {
    expect(
      getColorsHtml({
        cspSource: CSP_SOURCE,
        get nonce(): string {
          throw new Error('nonce');
        },
        scriptUri: 'a.js',
        styleUri: 'a.css',
      }),
    ).not.toContain('Content-Security-Policy');
    expect(
      getColorsHtml({
        cspSource: CSP_SOURCE,
        nonce: 'n',
        get scriptUri(): string {
          throw new Error('script');
        },
        styleUri: 'a.css',
      }),
    ).not.toContain('a.css');
    expect(
      getColorsHtml({
        cspSource: CSP_SOURCE,
        nonce: 'n',
        scriptUri: 'a.js',
        get styleUri(): string {
          throw new Error('css');
        },
      }),
    ).not.toContain('src="a.js"');
    expect(
      getColorsHtml({
        cspSource: CSP_SOURCE,
        nonce: 'n',
        scriptUri: 'a.js',
        styleUri: 'a.css',
        get bodyClass(): string {
          throw new Error('body');
        },
      }),
    ).not.toContain('Content-Security-Policy');
  });
});

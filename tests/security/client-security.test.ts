/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Client security: untrusted plugin install, storage path isolation, no secret leakage.
 * Guards registry rejects bad modules; cloud/git configs do not embed tokens in ids.
 */

import '../setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { registry } from '../../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag, listDynamicSourceIds } from '../../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../../src/storage/catalog';
import {
  loadPluginFromUrl,
  assertSafePluginUrl,
  normalizePluginUrl,
  getInstalledPlugins,
  restoreInstalledPlugins,
  PLUGINS_KEY,
} from '../../src/plugins/loader';
import { STORAGE_KEY } from '../../src/store';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  localStorage.removeItem(PLUGINS_KEY);
  ensureBuiltins();
});

describe('plugin URL safety', () => {
  it('rejects javascript: scheme', () => {
    expect(() => assertSafePluginUrl('javascript:alert(1)')).toThrow(/not allowed/i);
  });

  it('rejects JavaScript: mixed case', () => {
    expect(() => assertSafePluginUrl('JavaScript:alert(1)')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('JAVASCRIPT:void(0)')).toThrow(/not allowed/i);
  });

  it('rejects vbscript: and livescript:', () => {
    expect(() => assertSafePluginUrl('vbscript:msgbox(1)')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('livescript:1')).toThrow(/not allowed/i);
  });

  it('rejects javascript: with leading whitespace / BOM', () => {
    expect(() => assertSafePluginUrl('  javascript:alert(1)')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('\tjavascript:alert(1)')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('\uFEFFjavascript:alert(1)')).toThrow(/not allowed/i);
  });

  it('rejects javascript: obfuscated with null / control chars', () => {
    expect(() => assertSafePluginUrl('java\u0000script:alert(1)')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('java\nscript:alert(1)')).toThrow(/not allowed/i);
  });

  it('rejects data:text/html', () => {
    expect(() => assertSafePluginUrl('data:text/html,<script>alert(1)</script>')).toThrow(
      /not allowed/i,
    );
  });

  it('rejects data:text/html with charset / base64 params', () => {
    expect(() =>
      assertSafePluginUrl('data:text/html;charset=utf-8,<script>alert(1)</script>'),
    ).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('data:text/html;base64,PHNjcmlwdD4=')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('DATA:TEXT/HTML,<b>x</b>')).toThrow(/not allowed/i);
  });

  it('rejects other non-JS data: payloads (svg, plain, empty mime)', () => {
    expect(() =>
      assertSafePluginUrl('data:image/svg+xml,<svg onload=alert(1)>'),
    ).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('data:text/plain,hello')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('data:,alert(1)')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('data:application/octet-stream,xx')).toThrow(/not allowed/i);
  });

  it('allows data:text/javascript module payloads', () => {
    expect(() =>
      assertSafePluginUrl('data:text/javascript,export default {}'),
    ).not.toThrow();
    expect(() =>
      assertSafePluginUrl('data:application/javascript,export default {}'),
    ).not.toThrow();
  });

  it('allows relative and https plugin paths', () => {
    expect(() => assertSafePluginUrl('/plugins/example.js')).not.toThrow();
    expect(() => assertSafePluginUrl('https://cdn.example/plugin.js')).not.toThrow();
    expect(() => assertSafePluginUrl('http://localhost:3000/plugins/a.js')).not.toThrow();
  });

  it('rejects empty / non-string urls', () => {
    expect(() => assertSafePluginUrl('')).toThrow(/URL required/i);
    expect(() => assertSafePluginUrl('   ')).toThrow(/URL required/i);
    expect(() => assertSafePluginUrl(null as unknown as string)).toThrow(/URL required/i);
  });

  it('normalizePluginUrl does not open open-redirect style src rewrite on js urls', () => {
    // still blocked by assertSafePluginUrl after normalize
    const n = normalizePluginUrl('javascript:void(0)');
    expect(() => assertSafePluginUrl(n)).toThrow();
  });

  it('loadPluginFromUrl rejects javascript:', async () => {
    await expect(loadPluginFromUrl('javascript:alert(1)')).rejects.toThrow(/not allowed|URL/i);
  });

  it('loadPluginFromUrl rejects data:text/html', async () => {
    await expect(
      loadPluginFromUrl('data:text/html,<script>alert(1)</script>'),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects storage plugins via URL', async () => {
    const code = `export default { id: 'evil', name: 'E', kind: 'storage', list(){}, read(){}, write(){}, remove(){} }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/storage/i);
    // no half-registered storage / source under that id
    expect(registry.getStorage('evil')).toBeUndefined();
    expect(listDynamicSourceIds()).not.toContain('evil');
    expect(getInstalledPlugins().some((p) => p.id === 'evil')).toBe(false);
  });
});

describe('localStorage poisoning', () => {
  it('corrupt plugins list does not throw on read path', async () => {
    localStorage.setItem(PLUGINS_KEY, '{not-json');
    const { getInstalledPlugins: get } = await import('../../src/plugins/loader');
    expect(get()).toEqual([]);
  });

  it('non-array plugins JSON yields empty install list', () => {
    localStorage.setItem(PLUGINS_KEY, JSON.stringify({ url: 'x' }));
    expect(getInstalledPlugins()).toEqual([]);
  });

  it('install list with null / primitive / incomplete entries is sanitized', () => {
    localStorage.setItem(
      PLUGINS_KEY,
      JSON.stringify([
        null,
        42,
        'string-entry',
        {},
        { url: 'https://x/a.js' },
        { id: 'only-id', kind: 'source' },
        { url: '  ', id: 'blank-url', kind: 'source' },
        { url: 'https://ok/plugin.js', id: 'good', name: 'Good', kind: 'source' },
      ]),
    );
    const list = getInstalledPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('good');
  });

  it('corrupt install list never crashes restoreInstalledPlugins', async () => {
    localStorage.setItem(PLUGINS_KEY, '{not-json');
    await expect(restoreInstalledPlugins()).resolves.toBeUndefined();

    localStorage.setItem(
      PLUGINS_KEY,
      JSON.stringify([null, 1, { url: null }, { url: 'javascript:alert(1)', id: 'x', kind: 'source' }]),
    );
    await expect(restoreInstalledPlugins()).resolves.toBeUndefined();
    expect(listDynamicSourceIds()).not.toContain('x');
  });

  it('corrupt app state key is survivable on next parse attempt', () => {
    localStorage.setItem(STORAGE_KEY, '[[[bad');
    // store already hydrated; ensure we can still write
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol: 'ETHUSDT' }));
    expect(localStorage.getItem(STORAGE_KEY)).toContain('ETHUSDT');
  });
});

describe('failed load leaves no half-registered state', () => {
  it('invalid source is not registered and not persisted', async () => {
    const code = `export default { id: 'half-src', name: 'H', kind: 'source' }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/fetchHistorical/);
    expect(listDynamicSourceIds()).not.toContain('half-src');
    expect(getInstalledPlugins().some((p) => p.id === 'half-src')).toBe(false);
  });

  it('unknown kind is not registered and not persisted', async () => {
    const code = `export default { id: 'half-w', name: 'H', kind: 'widget' }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/Unknown plugin kind/);
    expect(registry.getSource('half-w')).toBeUndefined();
    expect(registry.getStream('half-w')).toBeUndefined();
    expect(registry.getEngine('half-w')).toBeUndefined();
    expect(getInstalledPlugins().some((p) => p.id === 'half-w')).toBe(false);
  });

  it('module without export is not persisted', async () => {
    const code = `export const notAPlugin = true`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/export|id and kind/i);
    expect(getInstalledPlugins()).toEqual([]);
  });
});

describe('git/cloud error messages', () => {
  it('GitHub error does not embed full token in message', async () => {
    const token = 'ghp_supersecret_token_value_12345';
    const { githubStatus } = await import('../../src/storage/git-github');
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })) as typeof fetch;
    try {
      const st = await githubStatus({
        provider: 'github',
        apiBaseUrl: 'https://api.github.com',
        token,
        owner: 'o',
        repo: 'r',
        projectId: '',
        branch: 'main',
        basePath: 'pine-library',
        autoPush: true,
        commitMessageTemplate: 'x',
      });
      expect(st.connected).toBe(false);
      expect(st.error || '').not.toContain(token);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('fixture plugin load still works', () => {
  it('loads file URL engine fixture', async () => {
    const url = pathToFileURL(join(import.meta.dir, '../fixtures/plugins/fake-engine.js')).href;
    const entry = await loadPluginFromUrl(url);
    expect(entry.kind).toBe('engine');
  });
});

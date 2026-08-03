/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Dynamic plugin loader: URL modules → registry registration.
 * Guards valid fixtures install; bad-no-export rejects cleanly.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag, listDynamicSourceIds } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag, listEngines } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import {
  PLUGINS_KEY,
  normalizePluginUrl,
  assertSafePluginUrl,
  loadPluginFromUrl,
  removePlugin,
  getInstalledPlugins,
  restoreInstalledPlugins,
} from '../src/plugins/loader';

const fixtures = join(import.meta.dir, 'fixtures/plugins');

function fileUrl(name: string) {
  return pathToFileURL(join(fixtures, name)).href;
}

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

describe('normalizePluginUrl', () => {
  it('rewrites /src/plugins/ to /plugins/', () => {
    expect(normalizePluginUrl('/src/plugins/example-coingecko-source.js')).toBe(
      '/plugins/example-coingecko-source.js',
    );
    expect(normalizePluginUrl('https://x.test/src/plugins/a.js')).toBe(
      'https://x.test/plugins/a.js',
    );
  });

  it('trims empty', () => {
    expect(normalizePluginUrl('  ')).toBe('');
  });

  it('returns empty for non-string', () => {
    expect(normalizePluginUrl(undefined as unknown as string)).toBe('');
    expect(normalizePluginUrl(null as unknown as string)).toBe('');
  });
});

describe('assertSafePluginUrl', () => {
  it('blocks dangerous schemes', () => {
    expect(() => assertSafePluginUrl('javascript:1')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('data:text/html,x')).toThrow(/not allowed/i);
    expect(() => assertSafePluginUrl('vbscript:1')).toThrow(/not allowed/i);
  });

  it('allows https and relative', () => {
    expect(() => assertSafePluginUrl('https://cdn.example/p.js')).not.toThrow();
    expect(() => assertSafePluginUrl('/plugins/p.js')).not.toThrow();
  });
});

describe('loadPluginFromUrl', () => {
  it('loads source fixture and persists install list', async () => {
    const entry = await loadPluginFromUrl(fileUrl('fake-source.js'));
    expect(entry.kind).toBe('source');
    expect(entry.id).toBe('test-fake-source');
    expect(listDynamicSourceIds()).toContain('test-fake-source');
    expect(getInstalledPlugins().some((p) => p.id === 'test-fake-source')).toBe(true);
  });

  it('loads engine and stream fixtures', async () => {
    await loadPluginFromUrl(fileUrl('fake-engine.js'));
    await loadPluginFromUrl(fileUrl('fake-stream.js'));
    expect(listEngines().some((e) => e.id === 'test-fake-engine')).toBe(true);
    expect(registry.getStream('test-fake-stream')).toBeDefined();
  });

  it('rejects module without plugin id/kind', async () => {
    await expect(loadPluginFromUrl(fileUrl('bad-no-export.js'))).rejects.toThrow(
      /id and kind|export/i,
    );
  });

  it('rejects empty url', async () => {
    await expect(loadPluginFromUrl('   ')).rejects.toThrow(/URL/i);
  });

  it('rejects javascript: scheme', async () => {
    await expect(loadPluginFromUrl('javascript:alert(1)')).rejects.toThrow(/not allowed/i);
  });

  it('rejects data:text/html scheme', async () => {
    await expect(
      loadPluginFromUrl('data:text/html,<script>alert(1)</script>'),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects storage kind via inline module', async () => {
    const code = `export default { id: 'x', name: 'X', kind: 'storage', list(){}, read(){}, write(){}, remove(){} }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/storage/i);
    expect(registry.getStorage('x')).toBeUndefined();
    expect(getInstalledPlugins().some((p) => p.id === 'x')).toBe(false);
  });

  it('rejects unknown kind', async () => {
    const code = `export default { id: 'x', name: 'X', kind: 'widget' }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/Unknown plugin kind/);
  });

  it('rejects source without fetchHistorical', async () => {
    const code = `export default { id: 'x', name: 'X', kind: 'source' }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/fetchHistorical/);
    expect(listDynamicSourceIds()).not.toContain('x');
    expect(getInstalledPlugins().some((p) => p.id === 'x')).toBe(false);
  });

  it('rejects stream without start and leaves no registry entry', async () => {
    const code = `export default { id: 'no-start', name: 'S', kind: 'stream' }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/start/i);
    expect(registry.getStream('no-start')).toBeUndefined();
    expect(getInstalledPlugins().some((p) => p.id === 'no-start')).toBe(false);
  });

  it('rejects engine without run and leaves no registry entry', async () => {
    const code = `export default { id: 'no-run', name: 'E', kind: 'engine' }`;
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    await expect(loadPluginFromUrl(url)).rejects.toThrow(/run/i);
    expect(registry.getEngine('no-run')).toBeUndefined();
    expect(getInstalledPlugins().some((p) => p.id === 'no-run')).toBe(false);
  });
});

describe('removePlugin / restore', () => {
  it('removePlugin drops install entry and unregisters', async () => {
    await loadPluginFromUrl(fileUrl('fake-source.js'));
    removePlugin('test-fake-source', 'source');
    expect(getInstalledPlugins().some((p) => p.id === 'test-fake-source')).toBe(false);
    expect(listDynamicSourceIds()).not.toContain('test-fake-source');
  });

  it('restoreInstalledPlugins reloads saved URLs', async () => {
    const url = fileUrl('fake-engine.js');
    localStorage.setItem(
      PLUGINS_KEY,
      JSON.stringify([{ url, id: 'test-fake-engine', name: 'Fake', kind: 'engine' }]),
    );
    // Clear registry engine dynamic state by re-bootstrap after clear
    registry.clear();
    _resetEngineRegistrationFlag();
    _resetBootstrapFlag();
    ensureBuiltins();
    await restoreInstalledPlugins();
    expect(listEngines().some((e) => e.id === 'test-fake-engine')).toBe(true);
  });

  it('restore logs error for bad urls without throwing', async () => {
    localStorage.setItem(
      PLUGINS_KEY,
      JSON.stringify([{ url: 'file:///nonexistent-plugin-xyz.js', id: 'x', name: 'X', kind: 'source' }]),
    );
    await restoreInstalledPlugins();
    // should not throw; failed URL not left half-registered
    expect(listDynamicSourceIds()).not.toContain('x');
  });

  it('restore survives corrupt / mixed install list without throwing', async () => {
    localStorage.setItem(
      PLUGINS_KEY,
      JSON.stringify([
        null,
        { url: 'javascript:alert(1)', id: 'evil', kind: 'source' },
        { url: fileUrl('fake-source.js'), id: 'test-fake-source', name: 'Fake', kind: 'source' },
        { broken: true },
        99,
      ]),
    );
    await expect(restoreInstalledPlugins()).resolves.toBeUndefined();
    // Valid fixture still restored; dangerous / invalid skipped
    expect(listDynamicSourceIds()).toContain('test-fake-source');
    expect(listDynamicSourceIds()).not.toContain('evil');
  });

  it('restore with completely invalid JSON never throws', async () => {
    localStorage.setItem(PLUGINS_KEY, '<<<not-json>>>');
    await expect(restoreInstalledPlugins()).resolves.toBeUndefined();
    expect(getInstalledPlugins()).toEqual([]);
  });
});

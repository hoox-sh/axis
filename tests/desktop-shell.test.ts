/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { isTauriShell } from '../src/desktop/is-tauri';
import {
  applyImportedPyneResult,
  type ImportEditorHost,
} from '../src/storage/import-pyne-open';
import type { ImportPyneResult } from '../src/storage/import-pyne-files';
import { importPyneSources } from '../src/storage/import-pyne-files';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import {
  _clearLocalLibraryForTests,
  _resetLocalMigrationFlag,
} from '../src/storage/local';
import { setActivePlugin } from '../src/store';

describe('isTauriShell', () => {
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;

  afterEach(() => {
    // @ts-expect-error restore
    globalThis.window = originalWindow;
    // @ts-expect-error restore
    globalThis.location = originalLocation;
  });

  it('is false in a normal browser stub', () => {
    // @ts-expect-error stub
    globalThis.window = {};
    // @ts-expect-error stub
    globalThis.location = { protocol: 'https:', hostname: 'example.com' };
    expect(isTauriShell()).toBe(false);
  });

  it('detects __TAURI_INTERNALS__', () => {
    // @ts-expect-error stub
    globalThis.window = { __TAURI_INTERNALS__: {} };
    // @ts-expect-error stub
    globalThis.location = { protocol: 'https:', hostname: 'example.com' };
    expect(isTauriShell()).toBe(true);
  });

  it('detects tauri.localhost host', () => {
    // @ts-expect-error stub
    globalThis.window = {};
    // @ts-expect-error stub
    globalThis.location = { protocol: 'https:', hostname: 'tauri.localhost' };
    expect(isTauriShell()).toBe(true);
  });
});

describe('applyImportedPyneResult', () => {
  it('opens editor tabs via loadLibraryDocs', () => {
    const opened: Array<{ content: string; name?: string; libraryId?: string }> = [];
    const editorRef: ImportEditorHost = {
      loadLibraryDocs: (docs) => {
        opened.push(...docs);
      },
    };

    const result: ImportPyneResult = {
      imported: [
        {
          meta: {
            id: 's1',
            name: 'RSI',
            content: '//@version=5\nindicator("RSI")\n',
            updatedAt: Date.now(),
          } as never,
          content: '//@version=5\nindicator("RSI")\n',
        },
      ],
      errors: [],
      warnings: [],
      skipped: 0,
    };

    applyImportedPyneResult(result, { editorRef, emptyContext: 'open' });
    expect(opened).toHaveLength(1);
    expect(opened[0]!.name).toBe('RSI');
    expect(opened[0]!.libraryId).toBe('s1');
    expect(opened[0]!.content).toContain('indicator("RSI")');
  });

  it('handles empty import without throwing', () => {
    const editorRef: ImportEditorHost = {};
    expect(() =>
      applyImportedPyneResult(
        { imported: [], errors: [], warnings: [], skipped: 0 },
        { editorRef, emptyContext: 'open' },
      ),
    ).not.toThrow();
  });
});

describe('importPyneSources (desktop open path)', () => {
  beforeEach(async () => {
    registry.clear();
    _resetSourceRegistrationFlag();
    _resetStreamRegistrationFlag();
    _resetEngineRegistrationFlag();
    _resetStorageRegistrationFlag();
    _resetBootstrapFlag();
    _resetLocalMigrationFlag();
    await _clearLocalLibraryForTests();
    ensureBuiltins();
    setActivePlugin('storage', 'local');
  });

  it('skips non-pine names and imports .pyne body', async () => {
    const result = await importPyneSources([
      { name: 'notes.txt', content: 'hello' },
      {
        name: 'demo.pyne',
        content: '//@version=5\nindicator("Demo")\nplot(close)\n',
        path: '/tmp/demo.pyne',
      },
    ]);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.meta.name).toBe('demo');
    expect(result.imported[0]!.content).toContain('indicator("Demo")');
    expect(result.imported[0]!.meta.path).toBe('/tmp/demo.pyne');
  });
});

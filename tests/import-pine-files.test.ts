/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Unit tests for .pine file → script library import helpers.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
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
import { listScripts, readScript } from '../src/storage/service';
import {
  isPineFileName,
  scriptNameFromFileName,
  filterPineFiles,
  importPineFiles,
  dataTransferHasPineFiles,
} from '../src/storage/import-pine-files';

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

function fakeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('isPineFileName', () => {
  it('accepts .pine and .pinescript (case-insensitive)', () => {
    expect(isPineFileName('rsi.pine')).toBe(true);
    expect(isPineFileName('MACD.PINE')).toBe(true);
    expect(isPineFileName('x.pinescript')).toBe(true);
    expect(isPineFileName('Y.PineScript')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(isPineFileName('lib.json')).toBe(false);
    expect(isPineFileName('data.csv')).toBe(false);
    expect(isPineFileName('readme.md')).toBe(false);
    expect(isPineFileName('')).toBe(false);
  });
});

describe('scriptNameFromFileName', () => {
  it('strips path and extension', () => {
    expect(scriptNameFromFileName('rsi.pine')).toBe('rsi');
    expect(scriptNameFromFileName('/tmp/foo/bar.pinescript')).toBe('bar');
    expect(scriptNameFromFileName('C:\\lib\\MACD.PINE')).toBe('MACD');
  });

  it('falls back when empty after strip', () => {
    expect(scriptNameFromFileName('.pine')).toBe('Imported');
    expect(scriptNameFromFileName('')).toBe('Imported');
  });
});

describe('filterPineFiles', () => {
  it('keeps only pine sources in order', () => {
    const files = [
      fakeFile('a.json', '[]'),
      fakeFile('rsi.pine', 'plot(1)'),
      fakeFile('notes.txt', 'x'),
      fakeFile('macd.pinescript', 'plot(2)'),
    ];
    const out = filterPineFiles(files);
    expect(out.map((f) => f.name)).toEqual(['rsi.pine', 'macd.pinescript']);
  });
});

describe('dataTransferHasPineFiles', () => {
  it('returns false for null/empty', () => {
    expect(dataTransferHasPineFiles(null)).toBe(false);
    expect(dataTransferHasPineFiles(undefined)).toBe(false);
  });

  it('detects Files type when file list is empty (dragover)', () => {
    const dt = {
      files: { length: 0 } as FileList,
      items: { length: 0 },
      types: ['Files'],
    } as unknown as DataTransfer;
    expect(dataTransferHasPineFiles(dt)).toBe(true);
  });

  it('detects pine files when FileList is populated', () => {
    const pine = fakeFile('x.pine', 'plot(1)');
    const dt = {
      files: [pine] as unknown as FileList,
      items: { length: 0 },
      types: ['Files'],
    } as unknown as DataTransfer;
    // filterPineFiles works on Array.from of FileList-like
    Object.defineProperty(dt, 'files', {
      value: {
        length: 1,
        0: pine,
        item: (i: number) => (i === 0 ? pine : null),
        [Symbol.iterator]: function* () {
          yield pine;
        },
      },
    });
    expect(dataTransferHasPineFiles(dt)).toBe(true);
  });
});

describe('importPineFiles', () => {
  it('writes pine files into the active library', async () => {
    const files = [
      fakeFile('My RSI.pine', '//@version=5\nindicator("RSI")\nplot(close)'),
      fakeFile('skip.json', '[]'),
      fakeFile('macd.pine', '//@version=5\nindicator("MACD")\nplot(open)'),
    ];
    const result = await importPineFiles(files);
    expect(result.imported.length).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.imported.map((d) => d.meta.name).sort()).toEqual(['My RSI', 'macd']);
    // Full body is returned with the import (no second read required for editor tabs)
    expect(result.imported.find((d) => d.meta.name === 'My RSI')?.content).toContain(
      'indicator("RSI")',
    );

    const list = await listScripts();
    expect(list.length).toBe(2);
    const rsi = list.find((m) => m.name === 'My RSI');
    expect(rsi).toBeTruthy();
    const doc = await readScript(rsi!.id);
    expect(doc.content).toContain('indicator("RSI")');
  });

  it('preserves every line of a large script body', async () => {
    const body = Array.from({ length: 400 }, (_, i) => `// line ${i + 1}`).join('\n');
    const result = await importPineFiles([fakeFile('big.pine', body)]);
    expect(result.imported.length).toBe(1);
    expect(result.imported[0]!.content).toBe(body);
    expect(result.imported[0]!.content.split('\n').length).toBe(400);
    const doc = await readScript(result.imported[0]!.meta.id);
    expect(doc.content).toBe(body);
  });

  it('reports empty files as errors', async () => {
    const result = await importPineFiles([fakeFile('empty.pine', '   \n')]);
    expect(result.imported.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('empty');
  });
});

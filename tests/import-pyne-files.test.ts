/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Unit tests for .pyne / .pine file → script library import helpers.
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
  isPyneFileName,
  scriptNameFromFileName,
  filterPyneFiles,
  importPyneFiles,
  dataTransferHasPyneFiles,
  sanitizePyneSource,
} from '../src/storage/import-pyne-files';

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

describe('isPyneFileName', () => {
  it('accepts .pyne, .pine, and .pinescript (case-insensitive)', () => {
    expect(isPyneFileName('rsi.pyne')).toBe(true);
    expect(isPyneFileName('RSI.PYNE')).toBe(true);
    expect(isPyneFileName('rsi.pine')).toBe(true);
    expect(isPyneFileName('MACD.PINE')).toBe(true);
    expect(isPyneFileName('x.pinescript')).toBe(true);
    expect(isPyneFileName('Y.PineScript')).toBe(true);
    expect(isPyneFileName('v.pinev5')).toBe(true);
    expect(isPyneFileName('v.pinev6')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(isPyneFileName('lib.json')).toBe(false);
    expect(isPyneFileName('data.csv')).toBe(false);
    expect(isPyneFileName('readme.md')).toBe(false);
    expect(isPyneFileName('')).toBe(false);
  });
});

describe('scriptNameFromFileName', () => {
  it('strips path and extension', () => {
    expect(scriptNameFromFileName('rsi.pyne')).toBe('rsi');
    expect(scriptNameFromFileName('rsi.pine')).toBe('rsi');
    expect(scriptNameFromFileName('/tmp/foo/bar.pinescript')).toBe('bar');
    expect(scriptNameFromFileName('C:\\lib\\MACD.PINE')).toBe('MACD');
  });

  it('falls back when empty after strip', () => {
    expect(scriptNameFromFileName('.pine')).toBe('Imported');
    expect(scriptNameFromFileName('.pyne')).toBe('Imported');
    expect(scriptNameFromFileName('')).toBe('Imported');
  });
});

describe('filterPyneFiles', () => {
  it('keeps only pyne/pine sources in order', () => {
    const files = [
      fakeFile('a.json', '[]'),
      fakeFile('rsi.pyne', 'plot(1)'),
      fakeFile('rsi.pine', 'plot(1)'),
      fakeFile('notes.txt', 'x'),
      fakeFile('macd.pinescript', 'plot(2)'),
    ];
    const out = filterPyneFiles(files);
    expect(out.map((f) => f.name)).toEqual(['rsi.pyne', 'rsi.pine', 'macd.pinescript']);
  });
});

describe('dataTransferHasPyneFiles', () => {
  it('returns false for null/empty', () => {
    expect(dataTransferHasPyneFiles(null)).toBe(false);
    expect(dataTransferHasPyneFiles(undefined)).toBe(false);
  });

  it('detects Files type when file list is empty (dragover)', () => {
    const dt = {
      files: { length: 0 } as FileList,
      items: { length: 0 },
      types: ['Files'],
    } as unknown as DataTransfer;
    expect(dataTransferHasPyneFiles(dt)).toBe(true);
  });

  it('detects pine files when FileList is populated', () => {
    const pine = fakeFile('x.pine', 'plot(1)');
    const dt = {
      files: [pine] as unknown as FileList,
      items: { length: 0 },
      types: ['Files'],
    } as unknown as DataTransfer;
    // filterPyneFiles works on Array.from of FileList-like
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
    expect(dataTransferHasPyneFiles(dt)).toBe(true);
  });
});

describe('importPyneFiles', () => {
  it('writes pine files into the active library', async () => {
    const files = [
      fakeFile('My RSI.pine', '//@version=5\nindicator("RSI")\nplot(close)'),
      fakeFile('skip.json', '[]'),
      fakeFile('macd.pine', '//@version=5\nindicator("MACD")\nplot(open)'),
    ];
    const result = await importPyneFiles(files);
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
    const body = Array.from({ length: 400 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n';
    const result = await importPyneFiles([fakeFile('big.pine', body)]);
    expect(result.imported.length).toBe(1);
    expect(result.imported[0]!.content).toBe(body);
    // trailing newline → 401 split parts with empty last; non-empty lines = 400
    expect(result.imported[0]!.content.trimEnd().split('\n').length).toBe(400);
    const doc = await readScript(result.imported[0]!.meta.id);
    expect(doc.content).toBe(body);
  });

  it('reports empty files as errors', async () => {
    const result = await importPyneFiles([fakeFile('empty.pine', '   \n')]);
    expect(result.imported.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('empty');
  });

  it('strips TradingView Expand (N lines) chrome and warns', async () => {
    const body =
      '//@version=5\nindicator("x")\nplot(close)\nExpand (132 lines)\n';
    const result = await importPyneFiles([fakeFile('tv.pine', body)]);
    expect(result.imported.length).toBe(1);
    expect(result.imported[0]!.content).not.toContain('Expand');
    expect(result.imported[0]!.content).toContain('plot(close)');
    expect(result.imported[0]!.missingLines).toBe(132);
    expect(result.warnings.some((w) => w.includes('132'))).toBe(true);
  });
});

describe('sanitizePyneSource', () => {
  it('removes Expand stub and reports missing line count', () => {
    const r = sanitizePyneSource(
      '//@version=5\nindicator("A")\nplot(1)\nExpand (42 lines)\nCopy code\n',
    );
    expect(r.content).toBe('//@version=5\nindicator("A")\nplot(1)\n');
    expect(r.missingLines).toBe(42);
    expect(r.warnings.length).toBe(1);
  });

  it('leaves clean pine untouched', () => {
    const src = '//@version=5\nindicator("ok")\nplot(close)\n';
    const r = sanitizePyneSource(src);
    expect(r.content).toBe(src);
    expect(r.missingLines).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('handles Expand without closing paren (bad scrape)', () => {
    const r = sanitizePyneSource('plot(1)\nExpand (10 lines\n');
    expect(r.content).toContain('plot(1)');
    expect(r.content).not.toMatch(/Expand/i);
    expect(r.missingLines).toBe(10);
  });
});

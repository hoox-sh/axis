// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drawing templates — pure serialize/deserialize + localStorage catalog.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { installMemoryLocalStorage } from './setup.ts';
import {
  DRAWING_TEMPLATES_KEY,
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  serializeDrawing,
  serializeDrawings,
  deserializeDrawing,
  deserializeDrawings,
  createTemplate,
  parseTemplate,
  parseTemplatesStore,
  applyTemplateDrawings,
  loadTemplates,
  saveTemplates,
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  exportTemplateJson,
  exportAllTemplatesJson,
  importTemplateJson,
  importTemplates,
  parseImportPayload,
} from '../src/chart/drawings/templates.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const legacyHline = {
  id: 'h1',
  kind: 'hline',
  color: '#ff0000',
  price: 42000.5,
  text: 'R1',
};

const legacyTrend = {
  id: 't1',
  kind: 'trend',
  color: '#939fff',
  p1: { time: 1_700_000_000, price: 100 },
  p2: { time: 1_700_000_600, price: 120 },
};

const unifiedText = {
  id: 'txt1',
  kind: 'text',
  points: [{ time: 10, price: 20 }],
  style: { color: '#0f0', width: 2, lineStyle: 'dashed', opacity: 0.9 },
  meta: { text: 'note' },
};

beforeEach(() => {
  installMemoryLocalStorage();
});

// ── serialize / deserialize (pure) ──────────────────────────────────────────

describe('serializeDrawing / deserializeDrawing', () => {
  it('serializes legacy hline to points-based shape', () => {
    const s = serializeDrawing(legacyHline);
    expect(s).not.toBeNull();
    expect(s!.id).toBe('h1');
    expect(s!.kind).toBe('hline');
    expect(s!.points).toEqual([{ time: 0, price: 42000.5 }]);
    expect(s!.style?.color).toBe('#ff0000');
    expect(s!.meta?.text).toBe('R1');
    // Portable shape has no legacy price top-level
    expect((s as { price?: number }).price).toBeUndefined();
  });

  it('serializes legacy two-point trend', () => {
    const s = serializeDrawing(legacyTrend);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('trend');
    expect(s!.points).toEqual([
      { time: 1_700_000_000, price: 100 },
      { time: 1_700_000_600, price: 120 },
    ]);
  });

  it('serializes unified text drawing', () => {
    const s = serializeDrawing(unifiedText);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('text');
    expect(s!.points).toEqual([{ time: 10, price: 20 }]);
    expect(s!.style?.lineStyle).toBe('dashed');
    expect(s!.meta?.text).toBe('note');
  });

  it('returns null for invalid / unknown kind', () => {
    expect(serializeDrawing(null)).toBeNull();
    expect(serializeDrawing({ kind: 'nope', points: [] })).toBeNull();
    expect(serializeDrawing({ kind: 'hline' /* missing price */ })).toBeNull();
  });

  it('deserialize rehydrates dual legacy fields for layer', () => {
    const s = serializeDrawing(legacyHline)!;
    const d = deserializeDrawing(s);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('hline');
    expect(d!.points[0]!.price).toBe(42000.5);
    expect((d as { price?: number }).price).toBe(42000.5);
    expect((d as { color?: string }).color).toBe('#ff0000');
  });

  it('round-trips a mixed drawings array', () => {
    const serialized = serializeDrawings([legacyHline, legacyTrend, unifiedText, { bad: true }]);
    expect(serialized).toHaveLength(3);

    const back = deserializeDrawings(serialized);
    expect(back).toHaveLength(3);
    expect(back.map((d) => d.kind)).toEqual(['hline', 'trend', 'text']);

    // trend dual p1/p2
    const trend = back[1] as { p1?: { price: number }; p2?: { price: number } };
    expect(trend.p1?.price).toBe(100);
    expect(trend.p2?.price).toBe(120);
  });

  it('serializeDrawings tolerates non-array', () => {
    expect(serializeDrawings(null)).toEqual([]);
    expect(serializeDrawings(undefined)).toEqual([]);
    expect(serializeDrawings({})).toEqual([]);
  });

  it('preserves visible / zIndex when present', () => {
    const s = serializeDrawing({
      ...legacyHline,
      visible: false,
      zIndex: 7,
    });
    expect(s!.visible).toBe(false);
    expect(s!.zIndex).toBe(7);
    const d = deserializeDrawing(s);
    expect((d as { visible?: boolean }).visible).toBe(false);
    expect((d as { zIndex?: number }).zIndex).toBe(7);
  });
});

// ── create / parse template ─────────────────────────────────────────────────

describe('createTemplate / parseTemplate', () => {
  it('creates a named template with meta', () => {
    const tpl = createTemplate('Support pack', [legacyHline, legacyTrend], {
      symbol: 'BTCUSDT',
      interval: '1h',
      exchange: 'binance',
    });
    expect(tpl.id.startsWith('tpl_')).toBe(true);
    expect(tpl.name).toBe('Support pack');
    expect(tpl.drawings).toHaveLength(2);
    expect(tpl.meta).toEqual({
      symbol: 'BTCUSDT',
      interval: '1h',
      exchange: 'binance',
    });
    expect(tpl.createdAt).toBeGreaterThan(0);
    expect(tpl.updatedAt).toBe(tpl.createdAt);
  });

  it('throws on empty name', () => {
    expect(() => createTemplate('  ', [])).toThrow(/name/i);
  });

  it('parseTemplate drops invalid drawings and requires name', () => {
    expect(parseTemplate(null)).toBeNull();
    expect(parseTemplate({ drawings: [] })).toBeNull();
    const t = parseTemplate({
      name: 'X',
      drawings: [legacyHline, { kind: 'garbage' }],
    });
    expect(t).not.toBeNull();
    expect(t!.drawings).toHaveLength(1);
    expect(t!.drawings[0]!.kind).toBe('hline');
  });

  it('parseTemplatesStore is tolerant of corrupt input', () => {
    expect(parseTemplatesStore(null).templates).toEqual([]);
    expect(parseTemplatesStore({ version: 1, templates: 'nope' }).templates).toEqual([]);
    const ok = parseTemplatesStore({
      version: 99,
      templates: [{ name: 'A', drawings: [legacyHline] }],
    });
    expect(ok.version).toBe(TEMPLATE_VERSION);
    expect(ok.templates).toHaveLength(1);
  });
});

// ── apply replace / merge ───────────────────────────────────────────────────

describe('applyTemplateDrawings', () => {
  it('replace returns only template drawings', () => {
    const tpl = createTemplate('T', [legacyHline]);
    const next = applyTemplateDrawings([legacyTrend], tpl, 'replace');
    expect(next).toHaveLength(1);
    expect(next[0]!.kind).toBe('hline');
    expect(next[0]!.id).toBe('h1');
  });

  it('merge appends and re-ids collisions', () => {
    const existing = deserializeDrawings([legacyHline]);
    // template reuses same h1 id
    const tpl = createTemplate('T', [
      { ...legacyHline, price: 99 },
      legacyTrend,
    ]);
    const next = applyTemplateDrawings(existing, tpl, 'merge');
    expect(next).toHaveLength(3);
    // original kept
    expect(next[0]!.id).toBe('h1');
    expect(next[0]!.points[0]!.price).toBe(42000.5);
    // collision re-id'd
    expect(next[1]!.id).not.toBe('h1');
    expect(next[1]!.points[0]!.price).toBe(99);
    // non-colliding trend keeps id
    expect(next[2]!.id).toBe('t1');
  });
});

// ── localStorage catalog ────────────────────────────────────────────────────

describe('localStorage template catalog', () => {
  it('save / list / get / delete', () => {
    expect(listTemplates()).toEqual([]);

    const saved = saveTemplate('My pack', [legacyHline, legacyTrend], {
      meta: { symbol: 'ETHUSDT', interval: '15m' },
    });
    expect(saved.name).toBe('My pack');
    expect(localStorage.getItem(DRAWING_TEMPLATES_KEY)).toBeTruthy();

    const list = listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0]!.drawingCount).toBe(2);
    expect(list[0]!.meta?.symbol).toBe('ETHUSDT');
    // summary omits drawings payload keys used for count only
    expect((list[0] as { drawings?: unknown }).drawings).toBeUndefined();

    const got = getTemplate(saved.id);
    expect(got).not.toBeNull();
    expect(got!.drawings).toHaveLength(2);

    expect(deleteTemplate(saved.id)).toBe(true);
    expect(getTemplate(saved.id)).toBeNull();
    expect(deleteTemplate(saved.id)).toBe(false);
  });

  it('saveTemplate with id overwrites in place', () => {
    const a = saveTemplate('A', [legacyHline]);
    const b = saveTemplate('A-renamed', [legacyTrend], { id: a.id });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('A-renamed');
    expect(b.drawings).toHaveLength(1);
    expect(b.drawings[0]!.kind).toBe('trend');
    expect(loadTemplates()).toHaveLength(1);
  });

  it('saveTemplates replaces catalog', () => {
    saveTemplate('One', [legacyHline]);
    const t = createTemplate('Two', [legacyTrend]);
    saveTemplates([t]);
    expect(loadTemplates().map((x) => x.name)).toEqual(['Two']);
  });
});

// ── export / import ─────────────────────────────────────────────────────────

describe('export / import JSON', () => {
  it('exportTemplateJson envelope round-trips', () => {
    const tpl = createTemplate('Pack', [legacyHline], { symbol: 'BTCUSDT' });
    const json = exportTemplateJson(tpl);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(TEMPLATE_FORMAT);
    expect(parsed.version).toBe(TEMPLATE_VERSION);
    expect(parsed.template.name).toBe('Pack');

    const imported = importTemplateJson(json);
    expect(imported).toHaveLength(1);
    expect(imported[0]!.name).toBe('Pack');
    expect(imported[0]!.drawings[0]!.kind).toBe('hline');
  });

  it('exportAllTemplatesJson + importTemplates', () => {
    saveTemplate('A', [legacyHline]);
    saveTemplate('B', [legacyTrend]);
    const json = exportAllTemplatesJson();
    const envelope = JSON.parse(json);
    expect(envelope.format).toBe('axis.drawingTemplates');
    expect(envelope.templates).toHaveLength(2);

    // wipe and re-import with new ids
    saveTemplates([]);
    const n = importTemplates(json, { forceNewIds: true });
    expect(n).toBe(2);
    expect(loadTemplates()).toHaveLength(2);
    // ids are fresh
    for (const t of loadTemplates()) {
      expect(t.id.startsWith('tpl_')).toBe(true);
    }
  });

  it('parseImportPayload accepts bare template and array', () => {
    const bare = parseImportPayload({
      name: 'Bare',
      drawings: [legacyHline],
    });
    expect(bare).toHaveLength(1);

    const arr = parseImportPayload([
      { name: 'X', drawings: [legacyHline] },
      { name: 'Y', drawings: [legacyTrend] },
    ]);
    expect(arr).toHaveLength(2);

    expect(parseImportPayload({ nonsense: true })).toEqual([]);
  });

  it('importTemplates forceNewIds false overwrites same id', () => {
    const t = createTemplate('Orig', [legacyHline]);
    saveTemplates([t]);
    const n = importTemplates(
      {
        format: TEMPLATE_FORMAT,
        version: 1,
        template: { ...t, name: 'Updated', drawings: serializeDrawings([legacyTrend]) },
      },
      { forceNewIds: false },
    );
    expect(n).toBe(1);
    expect(loadTemplates()).toHaveLength(1);
    expect(loadTemplates()[0]!.name).toBe('Updated');
    expect(loadTemplates()[0]!.drawings[0]!.kind).toBe('trend');
  });
});

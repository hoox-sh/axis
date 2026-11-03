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
import type { BuiltinCatalogEntry } from '../host/builtins';
import {
  parseLibraryWebMessage,
  toLibraryCards,
  toLibraryHostMessage,
  type LibraryCard,
} from './library-messages';

function entry(partial: Partial<BuiltinCatalogEntry> & { id: string }): BuiltinCatalogEntry {
  return {
    id: partial.id,
    title: partial.title ?? 'Title',
    shorttitle: partial.shorttitle ?? 'ST',
    description: partial.description ?? 'desc',
    category: partial.category ?? 'moving-average',
    categoryLabel: partial.categoryLabel ?? 'Moving averages',
    kind: partial.kind ?? 'indicator',
    overlay: partial.overlay ?? false,
    covers: partial.covers ?? 'covers',
    tags: partial.tags ?? ['ma'],
    code: partial.code ?? '//@version=6\nindicator("SECRET")',
  };
}

describe('toLibraryCards', () => {
  test('strips code and copies display fields', () => {
    const cards = toLibraryCards([
      entry({
        id: 'sma',
        title: 'AXIS SMA',
        shorttitle: 'SMA',
        description: 'Simple moving average',
        category: 'moving-average',
        categoryLabel: 'Moving averages',
        kind: 'indicator',
        overlay: true,
        covers: 'Simple moving average',
        tags: ['ma', 'sma'],
        code: 'SECRET_PINE_SOURCE',
      }),
    ]);
    expect(cards).toEqual([
      {
        id: 'sma',
        title: 'AXIS SMA',
        shorttitle: 'SMA',
        description: 'Simple moving average',
        category: 'moving-average',
        categoryLabel: 'Moving averages',
        kind: 'indicator',
        overlay: true,
        covers: 'Simple moving average',
        tags: ['ma', 'sma'],
      },
    ]);
    expect(cards[0]).not.toHaveProperty('code');
    expect(JSON.stringify(cards)).not.toContain('SECRET_PINE_SOURCE');
  });

  test('strategy kind, blank title fallback, non-string tags skipped', () => {
    const raw = entry({
      id: '  macd  ',
      title: '   ',
      shorttitle: '',
      kind: 'strategy',
      overlay: false,
      description: '',
      tags: ['ok', '', 1, 'two'] as unknown as string[],
    });
    (raw as { covers: unknown }).covers = 4;
    (raw as { category: unknown }).category = null;
    const cards = toLibraryCards([raw]);
    expect(cards[0]?.id).toBe('macd');
    expect(cards[0]?.title).toBe('macd');
    expect(cards[0]?.shorttitle).toBe('macd');
    expect(cards[0]?.kind).toBe('strategy');
    expect(cards[0]?.overlay).toBe(false);
    expect(cards[0]?.tags).toEqual(['ok', 'two']);
    expect(cards[0]?.covers).toBe('');
    expect(cards[0]?.category).toBe('');
    expect(cards[0]?.description).toBe('');
  });

  test('skips non-records, empty ids, and hostile field getters', () => {
    const throwId = {
      get id(): string {
        throw new Error('id');
      },
    };
    const throwTitle = {
      id: 'kept',
      get title(): string {
        throw new Error('title');
      },
      get shorttitle(): string {
        throw new Error('short');
      },
      get description(): string {
        throw new Error('desc');
      },
      get category(): string {
        throw new Error('cat');
      },
      get categoryLabel(): string {
        throw new Error('label');
      },
      get covers(): string {
        throw new Error('covers');
      },
      get kind(): string {
        throw new Error('kind');
      },
      get overlay(): boolean {
        throw new Error('overlay');
      },
      get tags(): string[] {
        throw new Error('tags');
      },
      code: 'NO_LEAK',
    };
    const cards = toLibraryCards([
      null,
      1,
      'x',
      { id: '   ' },
      { id: '' },
      throwId,
      throwTitle,
    ] as unknown as BuiltinCatalogEntry[]);
    expect(cards).toEqual([
      {
        id: 'kept',
        title: 'kept',
        shorttitle: 'kept',
        description: '',
        category: '',
        categoryLabel: '',
        kind: 'indicator',
        overlay: false,
        covers: '',
        tags: [],
      },
    ] satisfies LibraryCard[]);
    expect(JSON.stringify(cards)).not.toContain('NO_LEAK');
  });

  test('non-array and hostile iteration return []', () => {
    expect(toLibraryCards(null as never)).toEqual([]);
    expect(toLibraryCards(undefined as never)).toEqual([]);
    expect(toLibraryCards({} as never)).toEqual([]);
    expect(toLibraryCards('sma' as never)).toEqual([]);
    const hostile = new Proxy([entry({ id: 'a' })], {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator) throw new Error('iter');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(toLibraryCards(hostile as never)).toEqual([]);
  });

  test('kind other than strategy stays indicator; tags non-array is empty', () => {
    const raw = entry({ id: 'rsi', kind: 'indicator', tags: 'ma' as unknown as string[] });
    (raw as { kind: unknown }).kind = 'nope';
    (raw as { overlay: unknown }).overlay = 1;
    const [card] = toLibraryCards([raw]);
    expect(card?.kind).toBe('indicator');
    expect(card?.overlay).toBe(false);
    expect(card?.tags).toEqual([]);
  });
});

describe('toLibraryHostMessage', () => {
  test('init and state carry cards without code', () => {
    const scripts = [entry({ id: 'ema', title: 'AXIS EMA', code: 'PINE_BODY' })];
    const init = toLibraryHostMessage('library.init', scripts, 'disk missing');
    expect(init).toEqual({
      type: 'library.init',
      cards: [expect.objectContaining({ id: 'ema', title: 'AXIS EMA' })],
      catalogError: 'disk missing',
    });
    expect(JSON.stringify(init)).not.toContain('PINE_BODY');
    const state = toLibraryHostMessage('library.state', scripts, '');
    expect(state.type).toBe('library.state');
    expect(state.catalogError).toBe('');
    expect(state.cards[0]?.id).toBe('ema');
    expect(toLibraryHostMessage('library.init', scripts, 3 as never).catalogError).toBe('');
    expect(toLibraryHostMessage('library.state', scripts).catalogError).toBe('');
  });
});

describe('parseLibraryWebMessage', () => {
  test('ready, apply, and copy', () => {
    expect(parseLibraryWebMessage({ type: 'library.ready' })).toEqual({ type: 'library.ready' });
    expect(parseLibraryWebMessage({ type: 'library.ready', id: 'ignored', code: 'x' })).toEqual({
      type: 'library.ready',
    });
    expect(parseLibraryWebMessage({ type: 'library.apply', id: '  sma  ' })).toEqual({
      type: 'library.apply',
      id: 'sma',
    });
    expect(parseLibraryWebMessage({ type: 'library.copy', id: 'ema' })).toEqual({
      type: 'library.copy',
      id: 'ema',
    });
  });

  test('rejects hostile and incomplete payloads', () => {
    expect(parseLibraryWebMessage(null)).toBeNull();
    expect(parseLibraryWebMessage(undefined)).toBeNull();
    expect(parseLibraryWebMessage([])).toBeNull();
    expect(parseLibraryWebMessage('library.ready')).toBeNull();
    expect(parseLibraryWebMessage(1)).toBeNull();
    expect(parseLibraryWebMessage({ type: 'library.init', cards: [] })).toBeNull();
    expect(parseLibraryWebMessage({ type: 'nope' })).toBeNull();
    expect(parseLibraryWebMessage({ type: 1 })).toBeNull();
    expect(parseLibraryWebMessage({ type: 'library.apply' })).toBeNull();
    expect(parseLibraryWebMessage({ type: 'library.apply', id: '' })).toBeNull();
    expect(parseLibraryWebMessage({ type: 'library.apply', id: '   ' })).toBeNull();
    expect(parseLibraryWebMessage({ type: 'library.copy', id: 4 })).toBeNull();
    expect(parseLibraryWebMessage({ type: 'library.copy', id: { id: 'sma' } })).toBeNull();
    expect(
      parseLibraryWebMessage({
        get type(): string {
          throw new Error('type');
        },
      }),
    ).toBeNull();
    expect(
      parseLibraryWebMessage({
        type: 'library.apply',
        get id(): string {
          throw new Error('id');
        },
      }),
    ).toBeNull();
    expect(
      parseLibraryWebMessage({
        type: 'library.copy',
        get id(): string {
          throw new Error('id');
        },
      }),
    ).toBeNull();
  });
});

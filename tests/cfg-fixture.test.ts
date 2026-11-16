/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  applyCfgFixture,
  cfgSpecFor,
  mergeSchemaConfig,
  overlayConfigSchema,
  parseCfgFixture,
  shippedCfgFixture,
} from '../src/plugins/cfg-fixture';
import type { ConfigSchema } from '../src/plugins/types';

const base: ConfigSchema = {
  limit: { type: 'number', label: 'Limit', default: 500 },
  proxy: { type: 'string', label: 'Proxy', default: '' },
  venue: { type: 'select', label: 'Venue', options: ['binance'], default: 'binance' },
};

describe('cfg fixture', () => {
  it('parses the shipped file', () => {
    expect(shippedCfgFixture()).toEqual({});
  });

  it('hides, disables, and adds from lists', () => {
    const file = parseCfgFixture(`{
      "source:binance-rest": {
        "hide": ["proxy"],
        "disable": ["limit"],
        "add": {
          "note": { "type": "string", "label": "Note", "default": "desk" }
        }
      }
    }`);
    const next = applyCfgFixture(base, cfgSpecFor(file, 'source', 'binance-rest'));
    expect(next.proxy?.hidden).toBe(true);
    expect(next.limit?.disabled).toBe(true);
    expect(next.limit?.default).toBe(500);
    expect(next.note).toEqual({ type: 'string', label: 'Note', default: 'desk' });
    expect(next.venue?.options).toEqual(['binance']);
  });

  it('accepts a kind group and field shorthands', () => {
    const file = parseCfgFixture({
      source: {
        'binance-rest': {
          fields: {
            proxy: 'hide',
            limit: 'disable',
            region: { type: 'select', label: 'Region', options: ['com', 'us'], default: 'com' },
          },
        },
      },
    });
    const next = overlayConfigSchema('source', 'binance-rest', base, file);
    expect(next?.proxy?.hidden).toBe(true);
    expect(next?.limit?.disabled).toBe(true);
    expect(next?.region?.options).toEqual(['com', 'us']);
  });

  it('overloads an existing field without dropping unnamed props', () => {
    const next = applyCfgFixture(base, {
      add: { venue: { type: 'select', options: ['binance', 'okx'], default: 'okx' } },
    });
    expect(next.venue).toMatchObject({
      type: 'select',
      label: 'Venue',
      options: ['binance', 'okx'],
      default: 'okx',
    });
  });

  it('ignores unknown hide names and rejects a bad add', () => {
    const next = applyCfgFixture(base, { hide: ['missing'], disable: ['also-missing'] });
    expect(Object.keys(next).sort()).toEqual(['limit', 'proxy', 'venue']);
    expect(() => parseCfgFixture('{ "source:x": { "add": { "n": { "type": "nope" } } } }')).toThrow(
      /cfg fixture:/,
    );
  });

  it('keeps a disabled default over a stored value', () => {
    const schema: ConfigSchema = {
      limit: { type: 'number', default: 100, disabled: true },
      proxy: { type: 'string', default: '' },
    };
    expect(mergeSchemaConfig(schema, { limit: 5, proxy: 'https://gw' })).toEqual({
      limit: 100,
      proxy: 'https://gw',
    });
  });

  it('leaves a schema with no block untouched', () => {
    expect(overlayConfigSchema('engine', 'server', base, {})).toBe(base);
  });
});

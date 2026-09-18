/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { ensureRecordContent, jsonText } from '../src/mcp/protocol';

describe('MCP structuredContent envelope', () => {
  it('keeps plain objects as-is', () => {
    const out = jsonText({ ok: true, op: 'reset' }, true);
    const body = out.structuredContent as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect((out.content[0] as { text: string }).text).toContain('"ok"');
  });

  it('wraps arrays as { result }', () => {
    const out = jsonText([{ id: 'a' }]);
    const body = out.structuredContent as { result: unknown };
    expect(Array.isArray((body as { result: unknown }).result)).toBe(true);
    expect(typeof body).toBe('object');
    expect(Array.isArray(body)).toBe(false);
  });

  it('wraps primitives as { result }', () => {
    expect(ensureRecordContent('BTCUSDT')).toEqual({ result: 'BTCUSDT' });
    expect(ensureRecordContent(true)).toEqual({ result: true });
    expect(ensureRecordContent(42)).toEqual({ result: 42 });
    expect(ensureRecordContent(null)).toEqual({ result: null });
  });
});

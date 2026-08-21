/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { ccxtWsStream } from '../src/streams/catalog';
import { _resetStreamRegistrationFlag, ensureStreamsRegistered } from '../src/streams/catalog';

afterEach(() => {
  _resetStreamRegistrationFlag();
});

describe('ccxt-ws stream plugin', () => {
  it('has correct metadata', () => {
    expect(ccxtWsStream.id).toBe('ccxt-ws');
    expect(ccxtWsStream.kind).toBe('stream');
    expect(ccxtWsStream.builtIn).toBe(true);
    expect(ccxtWsStream.capabilities?.needsNetwork).toBe(true);
    expect(ccxtWsStream.capabilities?.transport).toBe('ws');
    expect(ccxtWsStream.capabilities?.klineStream).toBe(true);
  });

  it('is registered in BUILTIN_STREAMS', () => {
    ensureStreamsRegistered();
    const { listStreams } = require('../src/streams/catalog');
    const ids = listStreams().map((s: { id: string }) => s.id);
    expect(ids).toContain('ccxt-ws');
  });

  it('configSchema has exchange and gateway fields', () => {
    expect(ccxtWsStream.configSchema?.exchange).toBeDefined();
    expect(ccxtWsStream.configSchema?.gateway).toBeDefined();
  });
});

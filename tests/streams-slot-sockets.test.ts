/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { reconcile } from 'solid-js/store';
import { setIngestWorkerAvailableForTests } from '../src/hp/workers/host';
import { setEngineApiKey } from '../src/storage/vault';
import { setStore, store } from '../src/store';
import {
  acquireSlotWire,
  forgetChartSlotPins,
  getStreamWire,
  pinChartSlot,
  releaseSlotWire,
  resetStreamWire,
  streamSocketRefs,
  streamSocketSize,
  streamStop,
  streamWireFingerprint,
  unpinChartSlot,
} from '../src/streams/stream-live';

beforeEach(() => {
  setIngestWorkerAvailableForTests(false);
  setStore('activePlugins', reconcile({ ...(store.activePlugins ?? {}), engine: 'server' }) as never);
  setStore('engine', 'server');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('exchange', 'binance');
  setStore('endpoint', 'http://engine.test');
  setStore(
    'pluginsConfig',
    reconcile({
      'engine:server': { endpoint: 'http://engine.test', apiKey: 'key-1' },
    }) as never,
  );
  setEngineApiKey('server', 'key-1');
  forgetChartSlotPins();
  resetStreamWire();
});

afterEach(() => {
  streamStop();
  forgetChartSlotPins();
  setIngestWorkerAvailableForTests(null);
});

describe('chart slot socket pins (concept §4.1)', () => {
  it('getWire engine change does not leak a third live socket', async () => {
    await getStreamWire();
    expect(streamSocketSize()).toBe(1);
    const fpA = streamWireFingerprint();
    expect(streamSocketRefs(fpA)).toBe(1);
    setStore('endpoint', 'http://other.test');
    await getStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fpA)).toBe(0);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(1);
  });

  it('four slot pins of the same fingerprint share one client', () => {
    const fp = streamWireFingerprint();
    for (let i = 0; i < 4; i++) {
      const got = acquireSlotWire(fp, `slot-${i}`);
      expect(got.status).toBe('live');
    }
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(4);
    expect(releaseSlotWire(fp, 'slot-0')).toBeUndefined();
    expect(releaseSlotWire(fp, 'slot-1')).toBeUndefined();
    expect(releaseSlotWire(fp, 'slot-2')).toBeUndefined();
    expect(streamSocketSize()).toBe(1);
    const last = releaseSlotWire(fp, 'slot-3');
    expect(last).toBeDefined();
    expect(streamSocketSize()).toBe(0);
  });

  it('a third fingerprint queues until a slot releases', async () => {
    await getStreamWire();
    const fpB = streamWireFingerprint('http://b.test', 'k');
    const fpC = streamWireFingerprint('http://c.test', 'k');
    expect(acquireSlotWire(fpB, 's2').status).toBe('live');
    const third = acquireSlotWire(fpC, 's3');
    expect(third.status).toBe('queued');
    expect(streamSocketSize()).toBe(2);
    releaseSlotWire(fpB, 's2');
    if (third.status !== 'queued') throw new Error('expected queued');
    await third.wait;
    expect(streamSocketSize()).toBe(2);
    expect(streamSocketRefs(fpC)).toBe(1);
    expect(streamSocketRefs(fpB)).toBe(0);
  });

  it('a slot pin keeps the old endpoint when the primary moves', async () => {
    const fpA = streamWireFingerprint();
    await getStreamWire();
    const pin = acquireSlotWire(fpA, 'slot-2');
    expect(pin.status).toBe('live');
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fpA)).toBe(2);
    setStore('endpoint', 'http://other.test');
    await getStreamWire();
    expect(streamSocketSize()).toBe(2);
    expect(streamSocketRefs(fpA)).toBe(1);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(1);
    const primary = await getStreamWire();
    expect(primary).not.toBe(pin.status === 'live' ? pin.value : undefined);
    const dead = releaseSlotWire(fpA, 'slot-2');
    expect(dead).toBeDefined();
    expect(streamSocketSize()).toBe(1);
  });

  it('pinChartSlot: four hosts share one client; unpin three leaves one', () => {
    const fp = streamWireFingerprint();
    for (let i = 0; i < 4; i++) {
      const got = pinChartSlot(`slot-${i}`);
      expect(got?.status).toBe('live');
    }
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(4);
    expect(unpinChartSlot('slot-0')).toBeUndefined();
    expect(unpinChartSlot('slot-1')).toBeUndefined();
    expect(unpinChartSlot('slot-2')).toBeUndefined();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(1);
    const last = unpinChartSlot('slot-3');
    expect(last).toBeDefined();
    expect(streamSocketSize()).toBe(0);
  });

  it('unpinChartSlot releases the remembered fingerprint after the store endpoint moves', () => {
    const fpA = streamWireFingerprint();
    const pin = pinChartSlot('slot-A');
    expect(pin?.status).toBe('live');
    expect(streamSocketRefs(fpA)).toBe(1);
    setStore('endpoint', 'http://other.test');
    const fpB = streamWireFingerprint();
    expect(fpB).not.toBe(fpA);
    expect(streamSocketRefs(fpA)).toBe(1);
    expect(streamSocketRefs(fpB)).toBe(0);
    const dead = unpinChartSlot('slot-A');
    expect(dead).toBeDefined();
    expect(streamSocketRefs(fpA)).toBe(0);
    expect(streamSocketSize()).toBe(0);
  });

  it('double pin of the same slotId does not bump refs twice', () => {
    const fp = streamWireFingerprint();
    const first = pinChartSlot('slot-dup');
    const second = pinChartSlot('slot-dup');
    expect(first?.status).toBe('live');
    expect(second?.status).toBe('live');
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(1);
    expect(unpinChartSlot('slot-dup')).toBeDefined();
    expect(streamSocketSize()).toBe(0);
  });

  it('unpin of an unknown slot is a no-op', () => {
    expect(unpinChartSlot('ghost')).toBeUndefined();
    expect(unpinChartSlot('')).toBeUndefined();
    expect(streamSocketSize()).toBe(0);
    pinChartSlot('slot-x');
    expect(streamSocketSize()).toBe(1);
    expect(unpinChartSlot('slot-x')).toBeDefined();
    expect(unpinChartSlot('slot-x')).toBeUndefined();
    expect(streamSocketSize()).toBe(0);
  });

  it('resetStreamWire re-pins mounted slots onto the current fingerprint', () => {
    const fp = streamWireFingerprint();
    const first = pinChartSlot('slot-1');
    const second = pinChartSlot('slot-2');
    expect(first?.status).toBe('live');
    expect(second?.status).toBe('live');
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(2);
    if (first?.status !== 'live') throw new Error('expected live');
    const before = first.value;
    resetStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(2);
    const again = pinChartSlot('slot-1');
    expect(again?.status).toBe('live');
    if (again?.status !== 'live') throw new Error('expected live');
    expect(again.value).not.toBe(before);
    expect(streamSocketRefs(fp)).toBe(2);
    expect(unpinChartSlot('slot-1')).toBeUndefined();
    expect(unpinChartSlot('slot-2')).toBeDefined();
    expect(streamSocketSize()).toBe(0);
  });

  it('resetStreamWire does not resurrect an unpinned slot', () => {
    const fp = streamWireFingerprint();
    pinChartSlot('slot-keep');
    pinChartSlot('slot-drop');
    expect(streamSocketRefs(fp)).toBe(2);
    expect(unpinChartSlot('slot-drop')).toBeUndefined();
    expect(streamSocketRefs(fp)).toBe(1);
    resetStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(1);
    expect(unpinChartSlot('slot-drop')).toBeUndefined();
    expect(unpinChartSlot('slot-keep')).toBeDefined();
    expect(streamSocketSize()).toBe(0);
  });

  it('resetStreamWire with no pins leaves the pool empty', () => {
    expect(streamSocketSize()).toBe(0);
    const out = resetStreamWire();
    expect(out.hadWire).toBe(false);
    expect(streamSocketSize()).toBe(0);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(0);
  });

  it('streamStop then getWire re-pins the mounted slot ids', async () => {
    const fp = streamWireFingerprint();
    expect(pinChartSlot('slot-1')?.status).toBe('live');
    expect(pinChartSlot('slot-2')?.status).toBe('live');
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fp)).toBe(2);
    streamStop();
    expect(streamSocketSize()).toBe(0);
    expect(streamSocketRefs(fp)).toBe(0);
    await getStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(3);
    expect(unpinChartSlot('slot-1')).toBeUndefined();
    expect(streamSocketRefs(streamWireFingerprint())).toBe(2);
    expect(unpinChartSlot('slot-2')).toBeUndefined();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(1);
  });

  it('unpin then streamStop then getWire re-pins only the remaining slot', async () => {
    const fp = streamWireFingerprint();
    pinChartSlot('slot-keep');
    pinChartSlot('slot-drop');
    expect(streamSocketRefs(fp)).toBe(2);
    expect(unpinChartSlot('slot-drop')).toBeUndefined();
    expect(streamSocketRefs(fp)).toBe(1);
    streamStop();
    expect(streamSocketSize()).toBe(0);
    await getStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(2);
    expect(unpinChartSlot('slot-drop')).toBeUndefined();
    expect(streamSocketRefs(streamWireFingerprint())).toBe(2);
    expect(unpinChartSlot('slot-keep')).toBeUndefined();
    expect(streamSocketRefs(streamWireFingerprint())).toBe(1);
  });

  it('streamStop with no pins then getWire is one primary socket', async () => {
    expect(streamSocketSize()).toBe(0);
    streamStop();
    expect(streamSocketSize()).toBe(0);
    await getStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(streamWireFingerprint())).toBe(1);
  });

  it('streamStop then getWire pins onto the current fingerprint', async () => {
    const fpA = streamWireFingerprint();
    expect(pinChartSlot('slot-A')?.status).toBe('live');
    expect(streamSocketRefs(fpA)).toBe(1);
    streamStop();
    setStore('endpoint', 'http://other.test');
    const fpB = streamWireFingerprint();
    expect(fpB).not.toBe(fpA);
    await getStreamWire();
    expect(streamSocketSize()).toBe(1);
    expect(streamSocketRefs(fpA)).toBe(0);
    expect(streamSocketRefs(fpB)).toBe(2);
    expect(unpinChartSlot('slot-A')).toBeUndefined();
    expect(streamSocketRefs(fpB)).toBe(1);
  });
});

/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * P6 DoD: worker transport is the default; json is the rollback. The chart is
 * always the shared single-chart layout (the multi rollback is gone).
 */

import '../setup';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { installLightweightChartsMock } from '../helpers/mock-lwc';
import { Redesign2WsClient } from '../../src/engine/ws-client';
import {
  createLiveWsClient,
  IngestHostClient,
  setIngestWorkerFactory,
  type IngestWorkerTransport,
} from '../../src/hp/workers/host';
import {
  engineTransport,
  resetEngineTransport,
  setEngineTransport,
} from '../../src/engine/v1/transport';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager } = await import('../../src/chart/pane-manager');

function fakeWorker(): IngestWorkerTransport {
  return {
    postMessage() {},
    terminate() {},
    onmessage: null,
    onerror: null,
  };
}

function makeHost(): HTMLElement {
  const el = document.createElement('div') as unknown as HTMLElement;
  (el as { id: string }).id = 'p6-chart-root';
  document.body.appendChild(el as never);
  return el;
}

function priceVolume(pm: InstanceType<typeof PaneManager>) {
  const price = pm.createPane('price', 'price', 'Price');
  const volume = pm.createPane('volume', 'volume', 'Volume', 80);
  return { price, volume };
}

function paneIndex(pane: { chart: { addSeries: (type: never, opts?: unknown) => unknown } }) {
  return (pane.chart.addSeries('LineSeries' as never, {}) as { _paneIndex?: number })._paneIndex;
}

function enableResize(pane: {
  chart: { _options?: { layout?: { panes?: { enableResize?: boolean } } } };
}) {
  return pane.chart._options?.layout?.panes?.enableResize;
}

afterEach(() => {
  setIngestWorkerFactory(null);
  resetEngineTransport();
});

describe('P6 flag flip (concept DoD)', () => {
  test('worker is the default; json is the rollback; the chart stays shared', () => {
    expect(engineTransport()).toBe('worker');

    setIngestWorkerFactory(() => fakeWorker());
    const workerClient = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(workerClient).toBeInstanceOf(IngestHostClient);
    workerClient.disconnect();

    const host = makeHost();
    const pm = new PaneManager(host);
    try {
      const panes = priceVolume(pm);
      expect(paneIndex(panes.volume)).toBe(1);
      expect(enableResize(panes.price)).toBe(true);
      expect(document.getElementById(pm.paneDomId('volume'))?.style.display).toBe('none');
      expect(document.getElementById('pane-handle-volume')).toBeNull();
    } finally {
      pm.dispose();
      host.remove();
    }

    setEngineTransport('json');
    expect(engineTransport()).toBe('json');

    const jsonClient = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(jsonClient).toBeInstanceOf(Redesign2WsClient);
    expect(jsonClient).not.toBeInstanceOf(IngestHostClient);

    setEngineTransport('worker');
    expect(engineTransport()).toBe('worker');

    const restored = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(restored).toBeInstanceOf(IngestHostClient);
    restored.disconnect();
  });
});

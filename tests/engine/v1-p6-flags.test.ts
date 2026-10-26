/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * P6 DoD: worker+single is the default; json+multi is the paired rollback.
 * One flag flip of both keys together is the proof (concept §10).
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
import {
  chartLayoutMode,
  resetChartLayoutMode,
  setChartLayoutMode,
} from '../../src/chart/v1/chart-host';

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
  resetChartLayoutMode();
});

describe('P6 flag flip (concept DoD)', () => {
  test('worker+single is the default; json+multi is the paired rollback', () => {
    expect(engineTransport()).toBe('worker');
    expect(chartLayoutMode()).toBe('single');

    setIngestWorkerFactory(() => fakeWorker());
    const workerClient = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(workerClient).toBeInstanceOf(IngestHostClient);
    workerClient.disconnect();

    const singleHost = makeHost();
    const single = new PaneManager(singleHost);
    try {
      const panes = priceVolume(single);
      expect(paneIndex(panes.volume)).toBe(1);
      expect(enableResize(panes.price)).toBe(true);
      expect(document.getElementById(single.paneDomId('volume'))?.style.display).toBe('none');
      expect(document.getElementById('pane-handle-volume')).toBeNull();
    } finally {
      single.dispose();
      singleHost.remove();
    }

    setEngineTransport('json');
    setChartLayoutMode('multi');
    expect(engineTransport()).toBe('json');
    expect(chartLayoutMode()).toBe('multi');

    const jsonClient = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(jsonClient).toBeInstanceOf(Redesign2WsClient);
    expect(jsonClient).not.toBeInstanceOf(IngestHostClient);

    const multiHost = makeHost();
    const multi = new PaneManager(multiHost);
    try {
      const panes = priceVolume(multi);
      expect(paneIndex(panes.volume)).not.toBe(1);
      expect(enableResize(panes.price)).toBe(false);
      expect(document.getElementById('pane-handle-volume')).toBeTruthy();
    } finally {
      multi.dispose();
      multiHost.remove();
    }

    setEngineTransport('worker');
    setChartLayoutMode('single');
    expect(engineTransport()).toBe('worker');
    expect(chartLayoutMode()).toBe('single');

    const restored = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(restored).toBeInstanceOf(IngestHostClient);
    restored.disconnect();

    const restoredHost = makeHost();
    const restoredPm = new PaneManager(restoredHost);
    try {
      const panes = priceVolume(restoredPm);
      expect(paneIndex(panes.volume)).toBe(1);
      expect(enableResize(panes.price)).toBe(true);
      expect(document.getElementById('pane-handle-volume')).toBeNull();
    } finally {
      restoredPm.dispose();
      restoredHost.remove();
    }
  });
});

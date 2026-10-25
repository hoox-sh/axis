/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Connection HUD pure model: local vs worker endpoints, exec mode, transport path.
 * Invariant: `deriveHud` labels match endpoint classification for status UI.
 */

import { describe, expect, it } from 'bun:test';
import {
  deriveHud,
  feedChipMeta,
  feedChipView,
  feedStatusLabel,
  feedStatusTone,
  isLocalEndpoint,
  isWorkerEndpoint,
  composeCaption,
  liveBadgeLabel,
  liveBadgeTone,
  liveBadgeWord,
  liveIndicatorTitle,
  normalizeExecMode,
  transportToPath,
} from '../src/ui/hud-model';

describe('liveBadgeLabel / liveBadgeTone', () => {
  it('is OFF when Live is not armed', () => {
    expect(liveBadgeLabel({ liveActive: false, streamStatus: 'connected' })).toBe('OFF');
    expect(liveBadgeTone({ liveActive: false, streamStatus: 'connected' })).toBe('off');
  });

  it('is LIVE only while the socket is open', () => {
    expect(liveBadgeLabel({ liveActive: true, streamStatus: 'connected' })).toBe('LIVE');
    expect(liveBadgeTone({ liveActive: true, streamStatus: 'connected' })).toBe('live');
  });

  it('keeps the word Live while reconnecting, and does not use the success tone', () => {
    expect(liveBadgeLabel({ liveActive: true, streamStatus: 'connecting' })).toBe('Live');
    expect(liveBadgeTone({ liveActive: true, streamStatus: 'connecting' })).toBe('reconnect');
    expect(liveBadgeWord('reconnect')).toBe('Live');
    expect(liveBadgeWord('offline')).toBe('Offline');
    expect(
      liveIndicatorTitle({
        liveActive: true,
        streamStatus: 'connecting',
        detail: 'attempt 1/8 in 1000ms',
      }),
    ).toBe('Reconnecting · attempt 1/8 in 1000ms — click to stop');
  });

  it('names the compose chip in words', () => {
    expect(composeCaption({ run: 'server' })).toBe('Server');
    expect(composeCaption({ run: 'browser' })).toBe('Pyodide');
    expect(composeCaption({ run: 'worker' })).toBe('Worker');
  });

  it('shows Offline when armed but disconnected or in error', () => {
    expect(liveBadgeLabel({ liveActive: true, streamStatus: 'disconnected' })).toBe('Offline');
    expect(liveBadgeLabel({ liveActive: true, streamStatus: 'error' })).toBe('Offline');
    expect(liveBadgeTone({ liveActive: true, streamStatus: 'disconnected' })).toBe('offline');
  });

  it('names an open stream delayed Ns when the last event is at least 3s behind', () => {
    const at = 1_000;
    const exact = {
      liveActive: true,
      streamStatus: 'connected',
      lastEventAt: at,
      now: at + 3_000,
    };
    expect(liveBadgeLabel(exact)).toBe('LIVE · delayed 3s');
    expect(liveIndicatorTitle(exact)).toBe('Live · delayed 3s — click to stop');
    const floored = {
      liveActive: true,
      streamStatus: 'connected',
      lastEventAt: 0,
      now: 4_999,
    };
    expect(liveBadgeLabel(floored)).toContain('delayed 4s');
    expect(liveIndicatorTitle(floored)).toContain('delayed 4s');
  });

  it('does not add delayed under 3s, without a timestamp, or without now', () => {
    const fresh = {
      liveActive: true,
      streamStatus: 'connected',
      lastEventAt: 1_000,
      now: 1_000 + 2_999,
    };
    expect(liveBadgeLabel(fresh)).toBe('LIVE');
    expect(liveIndicatorTitle(fresh)).toBe('Live — click to stop');
    expect(
      liveIndicatorTitle({ liveActive: true, streamStatus: 'connected', now: 10_000 }),
    ).toBe('Live — click to stop');
    expect(
      liveBadgeLabel({
        liveActive: true,
        streamStatus: 'connected',
        lastEventAt: null,
        now: 10_000,
      }),
    ).toBe('LIVE');
    expect(
      liveIndicatorTitle({
        liveActive: true,
        streamStatus: 'connected',
        lastEventAt: 0,
      }),
    ).toBe('Live — click to stop');
  });

  it('keeps reconnecting text when the last event is old', () => {
    expect(
      liveBadgeLabel({
        liveActive: true,
        streamStatus: 'connecting',
        lastEventAt: 0,
        now: 60_000,
      }),
    ).toBe('Live');
    expect(
      liveIndicatorTitle({
        liveActive: true,
        streamStatus: 'connecting',
        detail: 'attempt 1/8 in 1000ms',
        lastEventAt: 0,
        now: 60_000,
      }),
    ).toBe('Reconnecting · attempt 1/8 in 1000ms — click to stop');
  });

  it('does not claim delayed when the socket is not open', () => {
    expect(
      liveBadgeLabel({
        liveActive: false,
        streamStatus: 'connected',
        lastEventAt: 0,
        now: 9_000,
      }),
    ).toBe('OFF');
    expect(
      liveIndicatorTitle({
        liveActive: true,
        streamStatus: 'disconnected',
        lastEventAt: 0,
        now: 9_000,
      }),
    ).toBe('Offline — click to stop');
  });
});

describe('hud-model helpers', () => {
  it('detects local endpoints', () => {
    expect(isLocalEndpoint('http://127.0.0.1:5002')).toBe(true);
    expect(isLocalEndpoint('http://localhost:5002')).toBe(true);
    expect(isLocalEndpoint('http://162.254.38.194:5002')).toBe(false);
  });

  it('detects worker endpoints', () => {
    expect(isWorkerEndpoint('https://pyne-worker.example.workers.dev')).toBe(true);
    expect(isWorkerEndpoint('http://162.254.38.194:5002')).toBe(false);
  });

  it('normalizes mode', () => {
    expect(normalizeExecMode('compile')).toBe('compile');
    expect(normalizeExecMode('nope')).toBe('interpret');
  });

  it('maps transport to PATH', () => {
    expect(transportToPath('ws')).toBe('WS');
    expect(transportToPath('rest')).toBe('REST');
    expect(transportToPath('local')).toBe('—');
  });
});

describe('deriveHud', () => {
  it('maps pyodide → ENG local, RUN browser, no PATH', () => {
    const h = deriveHud({
      engineId: 'pyodide',
      endpoint: 'http://162.254.38.194:5002',
      modeRaw: 'interpret',
    });
    expect(h.eng).toBe('local');
    expect(h.run).toBe('browser');
    expect(h.mode).toBe('interpret');
    expect(h.showPath).toBe(false);
    expect(h.product.toLowerCase()).toContain('pyodide');
  });

  it('maps server + loopback → ENG local, RUN server, PATH WS', () => {
    const h = deriveHud({
      engineId: 'server',
      endpoint: 'http://127.0.0.1:5002',
      modeRaw: 'compile',
      preferWs: true,
      engineTransport: 'ws',
    });
    expect(h.eng).toBe('local');
    expect(h.run).toBe('server');
    expect(h.mode).toBe('compile');
    expect(h.showPath).toBe(true);
    expect(h.path).toBe('WS');
  });

  it('maps server + VPS IP → ENG remote, RUN server', () => {
    const h = deriveHud({
      engineId: 'server',
      endpoint: 'http://162.254.38.194:5002',
      modeRaw: 'auto',
      preferWs: false,
    });
    expect(h.eng).toBe('remote');
    expect(h.run).toBe('server');
    expect(h.path).toBe('REST');
  });

  it('maps workers.dev endpoint → RUN worker, ENG remote', () => {
    const h = deriveHud({
      engineId: 'server',
      endpoint: 'https://pyne-worker.cryptolinx.workers.dev',
      modeRaw: 'auto',
      engineTransport: 'rest',
    });
    expect(h.eng).toBe('remote');
    expect(h.run).toBe('worker');
    expect(h.showPath).toBe(true);
    expect(h.path).toBe('REST');
  });

  it('flags pyodide loading from telemetry detail', () => {
    const h = deriveHud({
      engineId: 'pyodide',
      endpoint: '',
      engineState: 'connecting',
      detail: 'cold load ~20–30s',
    });
    expect(h.loading).toBe(true);
  });
});

describe('feedStatusTone / feedStatusLabel (F-18)', () => {
  it('maps subscription states to chip tones', () => {
    expect(feedStatusTone('live')).toBe('live');
    expect(feedStatusTone('degraded')).toBe('degraded');
    expect(feedStatusTone('error')).toBe('err');
    expect(feedStatusTone('idle')).toBe('idle');
    expect(feedStatusTone('datafeed-loading')).toBe('load');
    expect(feedStatusTone('calculating')).toBe('load');
  });

  it('labels degraded with staleness and loading with progress', () => {
    expect(feedStatusLabel('degraded', { updatedAt: 1000, now: 46000 })).toBe('degraded · 45s stale');
    expect(feedStatusLabel('datafeed-loading', { have: 2000, need: 10000 })).toBe('loading 2000/10000');
    expect(feedStatusLabel('live')).toBe('live');
    expect(feedStatusLabel('error', { message: 'boom' })).toBe('error · boom');
  });

  it('names the degraded cause when a message is present (F-28)', () => {
    expect(feedStatusLabel('degraded', { message: 'unverified close', updatedAt: 1000, now: 46000 })).toBe(
      'degraded · unverified close',
    );
    expect(feedStatusLabel('degraded', { message: 'venue+REST' })).toBe('degraded · venue+REST');
  });
});

describe('feedChipView — the chip says what the data path is', () => {
  it('reads live when an independent tier confirmed the close', () => {
    const v = feedChipView({ status: 'live', verified: 'venue', updatedAt: 1000, now: 2000 });
    expect(v.value).toBe('live');
    expect(v.tone).toBe('live');
  });

  it('keeps a live feed live when only the engine copy confirmed the close', () => {
    // The old chip relabeled this `degraded`, so the chip disagreed with the
    // engine plane (ws / open). The data flows — only the tier is weak.
    const v = feedChipView({ status: 'live', verified: 'engine', updatedAt: 1000, now: 2000 });
    expect(v.value).toBe('live·unverified');
    expect(v.tone).toBe('degraded');
    expect(v.title).toMatch(/engine copy/);
  });

  it('shows how long a feed that never came up has been stuck', () => {
    const v = feedChipView({ status: 'connecting', updatedAt: 1000, now: 46000 });
    expect(v.value).toBe('connecting · 45s');
    expect(v.tone).toBe('load');
    expect(v.title).toMatch(/venue \+ REST/);
  });

  it('does not add an age to a fresh connecting feed', () => {
    const v = feedChipView({ status: 'connecting', updatedAt: 1000, now: 2000 });
    expect(v.value).toBe('connecting');
  });

  it('keeps the degraded cause and the error text', () => {
    expect(
      feedChipView({ status: 'degraded', message: 'close mismatch', updatedAt: 1000, now: 2000 }).value,
    ).toBe('degraded · close mismatch');
    expect(feedChipView({ status: 'error', message: 'boom' }).value).toBe('error · boom');
  });
});

describe('feedChipMeta — the opened panel lists the facts', () => {
  it('includes state, freshness, tier, engine hop and series', () => {
    const rows = feedChipMeta({
      status: 'connecting',
      verified: 'engine',
      updatedAt: 1000,
      now: 46000,
      engineTransport: 'ws',
      engineState: 'open',
      engineLatencyMs: 1519,
      engineDetail: 'auto · ws · 1519ms',
      seriesKey: 'binance|spot|BTC/USDT|1m',
    });
    expect(rows).toContain('state connecting');
    expect(rows).toContain('updated 45s ago');
    expect(rows).toContain('verified engine copy · weak');
    expect(rows).toContain('engine ws · open · 1519ms');
    expect(rows).toContain('series binance|spot|BTC/USDT|1m');
  });

  it('omits the age for a live feed and names the strong tier', () => {
    const rows = feedChipMeta({
      status: 'live',
      verified: 'venue',
      updatedAt: 1000,
      now: 46000,
    });
    expect(rows.some((r) => r.startsWith('updated'))).toBe(false);
    expect(rows).toContain('verified venue · independent');
  });
});

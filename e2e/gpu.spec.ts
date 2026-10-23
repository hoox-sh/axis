/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @gpu HP-3 Playwright smoke: the forced-`webgl2` GPU candle overlay paints
 * live candles over the price pane.
 *
 * Flow: boot empty (autoload off, no Load click) with source `mock-walk`,
 * whose offline stream `mock-poll` emits a slot-aligned forming bar every
 * second; a local scripted WS server answers the series `subscribe` with a
 * `status` and a `full` snapshot of 120 × 1m bars ending at the current
 * slot. The snapshot union fills the chart, the ingest worker seeds the hot
 * SAB ring with the same count, and the overlay's ring-alignment guard
 * (`getBarsLength() === hotFrom + hotCount`) passes — the WebGL2 canvas
 * over the price pane must then carry non-zero alpha pixels.
 *
 * The server is a **real** local WebSocket server, not a `routeWebSocket`
 * mock: the ingest worker (HP-2) owns `/ws/live`, and Playwright's WS
 * routing intercepts only page-context sockets — a routed worker socket
 * would dial the live engine instead. The engine `endpoint` is seeded to
 * `ws://127.0.0.1:<port>` so both the worker socket and the main-thread
 * `/health` / `/run` fetches (page-route stubs) target the test host.
 *
 * Every 1m slot rollover re-seeds a `full` with `count+1` so the ring keeps
 * tracking the store as mock-poll opens new forming bars; both merge orders
 * (snapshot-first or venue-tick-first) converge to the same count.
 *
 * The cold-paging step shrinks the ring to 30 (the production shape: a 501
 * snapshot on a 9 500-bar chart) and asserts the cold viewport repaints
 * *without* zooming — first via the pixel-column downsample of the chart
 * window, then via the paged exact fill once the ingest worker replaces
 * the page slot. The overlay must never clear and never draw shifted.
 *
 * Run: `bunx playwright test e2e/gpu.spec.ts`
 */
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { seedAxisStore, seedManualLoad, stubAppNetwork } from './charts';

/** Chart interval (seeded) — mock-poll slot step, seconds. */
const STEP_SEC = 60;
/** Snapshot depth — the ring window the overlay samples. */
const SNAPSHOT_BARS = 120;

interface WireBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Deterministic walk — a pure function of time, so every `full` re-seed
 * paints the same values for the same slot and the chart never flickers
 * between snapshots.
 */
function walkBar(time: number): WireBar {
  const open = 100 + Math.sin(time / 1800) * 8;
  const close = 100 + Math.sin((time + STEP_SEC) / 1800) * 8;
  return {
    time,
    open,
    high: Math.max(open, close) + 0.4,
    low: Math.min(open, close) - 0.4,
    close,
    volume: 40 + Math.abs(Math.sin(time / 600)) * 60,
  };
}

/** `count` consecutive 1m bars ending at slot `end`. */
function snapshotBars(end: number, count: number): WireBar[] {
  const bars: WireBar[] = [];
  for (let i = count - 1; i >= 0; i--) bars.push(walkBar(end - i * STEP_SEC));
  return bars;
}

/** Current 1m slot on the test host clock (same clock mock-poll ticks on). */
const slotNow = (): number => Math.floor(Date.now() / 1000 / STEP_SEC) * STEP_SEC;

/** Snapshot depth after the shrink step — still shorter than the chart. */
const SHRUNK_BARS = 30;

/** Shrinks the ring below the chart count (production shape). */
let shrinkRing: (() => number) | null = null;

/** Server-side chain milestones — each narrows a failure to one hop. */
const state = {
  wsConnected: false,
  seriesSubscribed: false,
  fullSentCount: 0,
};

let wss: WebSocketServer;
let wsPort = 0;
/** Open client sockets — force-closed so `close()` never hangs. */
const clients = new Set<{ close: () => void; terminate: () => void }>();

test.beforeAll(async () => {
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (socket) => {
    state.wsConnected = true;
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    let seq = 0;
    let seriesSubbed = false;
    let rollover: ReturnType<typeof setInterval> | null = null;
    const sendFull = (id: string, end: number, count: number): void => {
      seq += 1;
      state.fullSentCount += 1;
      const bars = snapshotBars(end, count);
      socket.send(
        JSON.stringify({
          type: 'full',
          id,
          sessionId: 'e2e-gpu',
          seq,
          payload: {
            seriesKey: id,
            count: bars.length,
            closed_upto: end - STEP_SEC,
            bars,
          },
        }),
      );
    };
    socket.on('close', () => {
      if (rollover) clearInterval(rollover);
      shrinkRing = null;
    });
    socket.on('message', (data) => {
      let msg: { type?: string; id?: string; ts?: number; payload?: { kind?: string } };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        return;
      }
      if (msg.type !== 'subscribe' || !msg.id || msg.payload?.kind !== 'series') return;
      if (seriesSubbed) return;
      seriesSubbed = true;
      state.seriesSubscribed = true;
      const id = msg.id;
      const firstSlot = slotNow();
      let baseCount = SNAPSHOT_BARS;
      const countFor = (end: number): number => baseCount + (end - firstSlot) / STEP_SEC;
      socket.send(JSON.stringify({ type: 'status', id, payload: { code: 'live' } }));
      sendFull(id, firstSlot, countFor(firstSlot));
      // The production shape: the engine's live snapshot (501 in the wild)
      // is far shorter than the chart window (thousands of REST bars). Shrink
      // the ring below the chart count on demand so the spec can assert the
      // cold viewport repaints without zooming (downsample, then the paged
      // exact fill — never a clear, never a shifted frame) and paints the
      // tail window once the viewport moves inside it.
      shrinkRing = () => {
        baseCount = SHRUNK_BARS;
        sendFull(id, slotNow(), countFor(slotNow()));
        return baseCount;
      };
      // mock-poll appends one store bar per slot advance — re-seed the
      // ring at each boundary (slightly after the venue tick lands) so
      // the ring window keeps tracking the chart tail.
      let lastSeen = firstSlot;
      rollover = setInterval(() => {
        const slot = slotNow();
        if (slot === lastSeen) return;
        lastSeen = slot;
        setTimeout(() => {
          const end = slotNow();
          sendFull(id, end, countFor(end));
        }, 800);
      }, 250);
    });
  });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  wsPort = (wss.address() as AddressInfo).port;
});

test.afterAll(async () => {
  for (const socket of clients) socket.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

test.describe('GPU candle overlay @gpu', () => {
  test('paints live candles through the forced-webgl2 overlay', async ({ page }) => {
    test.setTimeout(90_000);

    // HP opt-in + forced rung + engine API key (vault slot, read by the wire
    // the same way every key-gated engine call reads it). The endpoint
    // targets the local WS server above (see the module docstring).
    await page.addInitScript(() => {
      localStorage.setItem('axis.engine.hp.enabled', '1');
      localStorage.setItem('axis.engine.hp.gpu', 'webgl2');
      localStorage.setItem(
        'axis.secret-vault.v1',
        JSON.stringify({ 'engine.server.apiKey': 'e2e-hp-key' }),
      );
    });
    // Autoload off keeps the chart empty (no Load click) — the /ws/live
    // snapshot is the sole series source; the stream preference picks the
    // offline mock-poll when live starts.
    await seedManualLoad(page);
    await seedAxisStore(page, {
      interval: '1m',
      endpoint: `http://127.0.0.1:${wsPort}`,
      live: { streamId: 'mock-poll' },
    });

    // Catch-all for secondary engine endpoints the app probes on the seeded
    // local endpoint (e.g. /data/session) — answer trivially so the console
    // stays clean for real diagnostics. Registered first: routes match in
    // reverse order, so the /health stub and /run stubs below shadow it.
    await page.route(`http://127.0.0.1:${wsPort}/**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: '{}',
      }),
    );

    // Engine /health → live_stream caps; hydrated by the indicator panel's
    // probe so the live ticks route through the stream plane.
    let healthHits = 0;
    await page.route('**/health', (route) => {
      healthHits += 1;
      void route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'healthy',
          features: {
            live_stream: true,
            live_modes: ['every-tick', 'bar-close'],
            data_session: true,
          },
        }),
      });
    });

    await stubAppNetwork(page);
    // Keep the ticker plane (main thread, page-routable) off the real venue.
    await page.routeWebSocket(/stream\.binance\.com/, (ws) => ws.close());
    // Diagnostics: every socket the page or its workers open, and errors.
    const sockets: string[] = [];
    const pageErrors: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/');
    await expect(page.getByTestId('axis-topbar')).toBeVisible();

    // Without WebGL2 there is nothing this spec can assert — skip elsewhere.
    const webgl2 = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!gl;
    });
    test.skip(!webgl2, 'WebGL2 unavailable in this browser');

    // Empty chart on the mock-walk source (offline mock-poll stream).
    await page.getByTestId('axis-select-source').selectOption('mock-walk');
    // Indicator panel mount probes engine /health → live_stream caps cached.
    await page.getByTestId('axis-btn-indicators').click();
    await expect.poll(() => healthHits, { timeout: 15_000 }).toBeGreaterThan(0);

    // Live start: mock-poll ticks → stream route → wire → /ws/live subscribe
    // (owned by the ingest worker — HP-2) → full snapshot → ring seed.
    await page.getByTestId('axis-btn-live').click();
    await expect(page.getByTestId('axis-btn-live')).toHaveAttribute('aria-pressed', 'true');

    // Chain milestones — each narrows a failure to one hop.
    await expect.poll(() => state.wsConnected, { timeout: 15_000 }).toBe(true);
    await expect.poll(() => state.seriesSubscribed, { timeout: 15_000 }).toBe(true);
    await expect.poll(() => state.fullSentCount, { timeout: 15_000 }).toBeGreaterThan(0);
    console.log('[gpu-e2e] sockets:', sockets.join(', ') || '(none)');
    console.log('[gpu-e2e] page errors:', pageErrors.join(' | ') || '(none)');

    // The overlay canvas shows on its first successful frame (the placement
    // guard — tail identity, contained viewport, linear scale — passed).
    const canvas = page.locator('canvas[data-axis-gpu-overlay="1"]');
    await expect(canvas).toBeVisible({
      timeout: 20_000,
    });

    // Alpha-nonzero pixels in the framebuffer = GL candles over the
    // transparent clear. Read inside rAF so the just-drawn buffer is still
    // intact (no preserveDrawingBuffer). A guard bail clears the canvas but
    // keeps `display:block` (LWC shows through) — so "cleared" is alpha 0,
    // not invisible.
    const nonzeroPixels = (): Promise<number> =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            requestAnimationFrame(() => {
              const el = document.querySelector('canvas[data-axis-gpu-overlay="1"]');
              const gl = el instanceof HTMLCanvasElement ? el.getContext('webgl2') : null;
              if (!gl) return resolve(-1);
              const w = gl.drawingBufferWidth;
              const h = gl.drawingBufferHeight;
              const px = new Uint8Array(w * h * 4);
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
              let nonzero = 0;
              for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) nonzero += 1;
              resolve(nonzero);
            });
          }),
      );

    await expect.poll(nonzeroPixels, { timeout: 20_000 }).toBeGreaterThan(0);

    // Production shape: the engine's live snapshot is far shorter than the
    // chart window (a 501-bar snapshot on a 9 500-bar chart). Shrink the ring
    // below the visible span: the viewport then starts in colder history than
    // the ring. Cold paging (§9.2) must repaint it *without* zooming — first
    // the pixel-column downsample of the chart window (same frame the ring
    // re-seeds), then the paged exact fill once the ingest worker replaces
    // the page slot. Clearing or a shifted frame fails the poll below.
    expect(shrinkRing).not.toBeNull();
    expect(shrinkRing?.()).toBe(SHRUNK_BARS);
    await expect.poll(nonzeroPixels, { timeout: 15_000 }).toBeGreaterThan(0);

    // Zoom into the tail (wheel anchored right): the viewport now sits inside
    // the ring window, so the placement offset must paint the right candles.
    const anchor = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas')).filter(
        (el) => el.clientWidth > 300 && el.clientHeight > 150,
      );
      canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      const c = canvases[0];
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width * 0.8, y: r.top + r.height / 2 };
    });
    expect(anchor).not.toBeNull();
    if (anchor) {
      await page.mouse.move(anchor.x, anchor.y);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, -600);
        await page.waitForTimeout(150);
        if ((await nonzeroPixels()) > 0) break;
      }
    }
    await expect.poll(nonzeroPixels, { timeout: 10_000 }).toBeGreaterThan(0);
  });
});

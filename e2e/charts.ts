/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Shared Playwright helpers for chart/drawing e2e specs. */

import { expect, type Page } from '@playwright/test';

/** App-state localStorage key (see `src/store/index.ts` `STORAGE_KEY`). */
const AXIS_STORE_KEY = 'pynescript.axis.v1';

/**
 * Seed app state before boot so specs can drive a specific path.
 *
 * `autoload` defaults to `true`, which *hides* the manual Load button — a spec
 * that wants to click Load must opt out, or the button assertion fails for a
 * reason that has nothing to do with topbar wiring.
 *
 * Seeds only when the key is **absent** and merges into any existing payload.
 * `addInitScript` re-runs on every navigation, so an unconditional
 * `setItem` would reset the app to its seeded state on reload and wipe state
 * the test just created (drawings, scripts, layout).
 */
export async function seedAxisStore(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, data]) => {
      const existing = window.localStorage.getItem(key as string);
      const merged = existing ? { ...(JSON.parse(existing) as object), ...(data as object) } : data;
      window.localStorage.setItem(key as string, JSON.stringify(merged));
    },
    [AXIS_STORE_KEY, patch] as const,
  );
}

/** Disable autoload so the manual `axis-btn-load` button is rendered. */
export async function seedManualLoad(page: Page): Promise<void> {
  await seedAxisStore(page, { autoload: false });
}

/**
 * Engine `/run` API paths only.
 *
 * A glob of star-star/run/star-star also matches Vite chunks named
 * runner-*.js, which starves the lazy editor (and anything else that
 * imports runner.ts).
 */
export function isEngineRunUrl(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return path === '/run' || path.endsWith('/run');
}

const DEFAULT_RUN_BODY = {
  status: 'success',
  plots: [1, 2, 3, 4, 5],
  series: {},
  events: [],
  meta: { script_name: 'e2e', overlay: true, ms: 12 },
};

/** Stub Pro API run + venue traffic so specs never touch the network. */
export async function stubAppNetwork(
  page: Page,
  runBody: Record<string, unknown> = DEFAULT_RUN_BODY,
): Promise<void> {
  await page.route(isEngineRunUrl, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runBody),
    });
  });
  await page.route('**/api.binance.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
}

export type LoadMockBarsOpts = {
  /** Settings → Historical bars. Seeded before boot. */
  historyBars?: number;
  /** Chart rolling window. Seeded before boot. */
  rollingWindowBars?: number;
  /** Bar interval (`1m`, `15m`, …). Seeded before boot. */
  interval?: string;
};

/** Boot on `/` and load mock-walk bars so the chart has a drawable series. */
export async function loadMockBars(page: Page, opts: LoadMockBarsOpts = {}): Promise<void> {
  // Autoload hides the manual Load button; opt out before boot.
  await seedAxisStore(page, {
    autoload: false,
    ...(opts.historyBars != null ? { historyBars: opts.historyBars } : {}),
    ...(opts.rollingWindowBars != null ? { rollingWindowBars: opts.rollingWindowBars } : {}),
    ...(opts.interval ? { interval: opts.interval } : {}),
  });
  await page.goto('/');
  await expect(page.getByTestId('axis-topbar')).toBeVisible();
  await page.getByTestId('axis-select-source').selectOption('mock-walk');
  await page.getByTestId('axis-btn-load').click();
  await expect(page.getByTestId('axis-status-message')).toContainText(/Loaded \d+ bars|Ready/i, {
    timeout: 30_000,
  });
  await expect(page.locator('[data-axis-chart-host]')).toBeVisible();
}

/** Start the default live stream (mock-poll when the source is mock-walk). */
export async function startMockLive(page: Page): Promise<void> {
  const live = page.getByTestId('axis-btn-live');
  await expect(live).toBeVisible();
  await expect
    .poll(
      async () => {
        if ((await live.getAttribute('aria-pressed')) === 'true') return true;
        await live.evaluate((el: HTMLElement) => el.click());
        return (await live.getAttribute('aria-pressed')) === 'true';
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * Apply overlay=false builtins from the Script Library. Each Apply hits the
 * stubbed `/run` and creates a private indicator pane.
 */
export async function applyBuiltinPanes(page: Page, ids: readonly string[]): Promise<void> {
  const libBtn = page.getByTestId('axis-btn-library');
  await expect(libBtn).toBeVisible();
  if ((await libBtn.getAttribute('aria-pressed')) !== 'true') {
    await libBtn.click();
  }
  await expect(page.getByTestId('axis-library-builtin-list')).toBeVisible();
  for (const id of ids) {
    const search = page.getByTestId('axis-library-builtin-search');
    await search.fill(id);
    const apply = page.locator(`[data-builtin-id="${id}"]`).getByTestId('axis-library-builtin-apply');
    await expect(apply).toBeVisible();
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page.getByTestId('axis-status-message')).toContainText(/Applied built-in/i, {
      timeout: 15_000,
    });
    await expect(apply).toBeEnabled();
  }
  await expect(page.getByText(new RegExp(`${ids.length} scripts\\s*·\\s*\\d+ panes`))).toBeVisible({
    timeout: 10_000,
  });
  if ((await libBtn.getAttribute('aria-pressed')) === 'true') {
    await libBtn.click();
  }
  const scriptsBtn = page.getByTestId('axis-btn-indicators');
  if ((await scriptsBtn.getAttribute('aria-pressed')) === 'true') {
    await scriptsBtn.click();
  }
}

/** Advance fake timers so mock-poll emits a new closed bar (window slide). */
export async function slideLiveWindow(page: Page, ms = 70_000): Promise<void> {
  await page.clock.install();
  await startMockLive(page);
  await page.clock.fastForward(ms);
}

/** Last time-axis tick strings painted in each Lightweight Charts table. */
export async function paneTimeTicks(page: Page): Promise<{
  charts: number;
  paneChrome: number;
  uniqueLastTicks: string[];
}> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-axis-chart-host]');
    if (!root) {
      return { charts: 0, paneChrome: 0, uniqueLastTicks: [] as string[] };
    }
    const charts = Array.from(root.querySelectorAll('.tv-lightweight-charts'));
    const lastTicks: string[] = [];
    for (const chart of charts) {
      const rows = chart.querySelectorAll('table tr');
      const last = rows[rows.length - 1];
      const tick = last?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (tick) lastTicks.push(tick);
    }
    return {
      charts: charts.length,
      paneChrome: document.querySelectorAll('[data-axis-pane-chrome]').length,
      uniqueLastTicks: [...new Set(lastTicks)],
    };
  });
}

/** Open a toolbar group flyout and pick a tool; asserts the active indicator. */
export async function selectDrawingTool(
  page: Page,
  groupId: string,
  toolLabel: string,
): Promise<void> {
  const toolbar = page.getByTestId('axis-drawing-toolbar');
  await expect(toolbar).toBeVisible();

  // Groups render as a wrapper (`data-drawing-group`) holding the primary tool
  // button plus a caret that opens the flyout. The wrapper carries the
  // `is-active` state, and the primary button's accessible name is the *tool*
  // ("Trend line"), not the group label — so target the group id and open the
  // flyout through its caret. Ids come from TOOL_GROUPS in
  // `src/chart/drawings/tool-catalog.ts`.
  const group = toolbar.locator(`[data-drawing-group="${groupId}"]`);
  await expect(group).toBeVisible();
  await group.locator('[aria-label^="More"]').click();
  await page.getByRole('menuitemradio', { name: toolLabel }).click();

  // Wrapper stays active while one of its tools is selected.
  await expect(group).toHaveClass(/is-active/);
  // Layers panel mirrors the active tool name.
  await page.getByTestId('axis-btn-layers').click();
  await expect(page.getByTestId('axis-layers-active-tool')).toContainText(toolLabel);
  // Close the panel so it never covers the chart for placement clicks.
  await page.getByTestId('axis-btn-layers').click();
}

/** Click inside the chart host at a fractional offset (default: left third). */
export async function clickChart(page: Page, xRatio = 0.3, yRatio = 0.4): Promise<void> {
  const host = page.locator('[data-axis-chart-host]').first();
  const box = await host.boundingBox();
  if (!box) throw new Error('chart host has no bounding box');
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

/** Number of user-drawing SVG shapes (excludes pyne fills/drawings and toolbar icons). */
export async function drawingShapeCount(page: Page): Promise<number> {
  return page
    .locator(
      '[data-axis-chart-host] svg.axis-drawing-layer > g.axis-user-drawings :is(line, path, rect, circle, ellipse)',
    )
    .count();
}

/** Drag the chart host horizontally (pan) and optionally wheel-zoom. */
export async function panChart(page: Page, dxRatio = -0.2): Promise<void> {
  const host = page.locator('[data-axis-chart-host]').first();
  const box = await host.boundingBox();
  if (!box) throw new Error('chart host has no bounding box');
  const y = box.y + box.height * 0.5;
  const fromX = box.x + box.width * 0.55;
  const toX = box.x + box.width * (0.55 + dxRatio);
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 12 });
  await page.mouse.up();
}

/** Wheel-zoom at the center of the chart host. */
export async function zoomChart(page: Page, deltaY = 400): Promise<void> {
  const host = page.locator('[data-axis-chart-host]').first();
  await host.hover();
  await page.mouse.wheel(0, deltaY);
}

/**
 * Sample rAF frame deltas while `work` runs. Used by the v1 pan/zoom e2e.
 * CI skips the 50 ms gate (concept §11: no machine-dependent thresholds).
 */
export async function measureRafDuring(
  page: Page,
  work: () => Promise<void>,
): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __axisFrames?: number[];
      __axisRafId?: number;
    };
    w.__axisFrames = [];
    let last = performance.now();
    const tick = (ts: number) => {
      w.__axisFrames?.push(ts - last);
      last = ts;
      w.__axisRafId = requestAnimationFrame(tick);
    };
    w.__axisRafId = requestAnimationFrame(tick);
  });
  await work();
  await page.waitForTimeout(80);
  return page.evaluate(() => {
    const w = window as unknown as { __axisFrames?: number[]; __axisRafId?: number };
    if (w.__axisRafId != null) cancelAnimationFrame(w.__axisRafId);
    return w.__axisFrames ?? [];
  });
}

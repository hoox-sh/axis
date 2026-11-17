/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Studio open routing — the `axis-open-studio` seam.
 *
 * Settings → Source → Open Data, the topbar Data button, and the status-bar
 * dataset count all dispatch `openStudioPage('data')`; `app.tsx` routes that
 * event detail through `createStudioRouter`. This suite drives the event and
 * asserts the resulting page state, so the Data shortcuts are executed rather
 * than grepped out of the three TSX files. The button bindings themselves are
 * covered by `e2e/studio-data-source.spec.ts` in a real browser.
 */

import './setup';
import { describe, expect, it, mock } from 'bun:test';
import type { StudioPageId } from '../src/ui/studio/types';
import type { StudioRouter } from '../src/ui/studio/open-studio';

const solid = await import('solid-js/dist/dev.js');
mock.module('solid-js', () => solid);

const { OPEN_STUDIO_EVENT, createStudioRouter, openStudioPage, studioPageFromDetail } =
  await import('../src/ui/studio/open-studio');
const { STUDIO_PAGES } = await import('../src/ui/studio/pages');

/** Replace `window` with a dispatch recorder for the duration of `fn`. */
function captureDispatched(fn: () => void): CustomEvent[] {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const previous = g.window;
  const events: CustomEvent[] = [];
  g.window = {
    ...(previous || {}),
    dispatchEvent: (e: Event) => {
      events.push(e as CustomEvent);
      return true;
    },
  };
  try {
    fn();
  } finally {
    g.window = previous;
  }
  return events;
}

describe('openStudioPage dispatches the studio event', () => {
  it('sends page=data in the detail', () => {
    const events = captureDispatched(() => openStudioPage('data'));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(OPEN_STUDIO_EVENT);
    expect(events[0]?.detail).toEqual({ page: 'data' });
  });
});

describe('studioPageFromDetail', () => {
  it('accepts every registered studio page', () => {
    for (const page of STUDIO_PAGES) {
      expect(studioPageFromDetail({ page: page.id })).toBe(page.id);
    }
  });

  it('falls back to Wire for unknown or missing detail', () => {
    expect(studioPageFromDetail({ page: 'nope' })).toBe('wire');
    expect(studioPageFromDetail({})).toBe('wire');
    expect(studioPageFromDetail(null)).toBe('wire');
    expect(studioPageFromDetail(undefined)).toBe('wire');
    expect(studioPageFromDetail('data')).toBe('wire');
  });
});

describe('createStudioRouter', () => {
  it('opens, closes, and routes event details', () => {
    const router: StudioRouter = createStudioRouter();
    expect(router.page()).toBeNull();

    router.handleDetail({ page: 'data' });
    expect(router.page()).toBe('data');

    router.close();
    expect(router.page()).toBeNull();

    router.handleDetail({ page: 'workers' });
    expect(router.page()).toBe('workers');
  });

  it('lands on the Data page when the dispatched event is routed back in', () => {
    const router = createStudioRouter();
    const events = captureDispatched(() => openStudioPage('data'));

    router.handleDetail(events[0]?.detail);

    expect(router.page()).toBe('data');
  });

  it('starts on the given page', () => {
    const router = createStudioRouter('runtime' satisfies StudioPageId);
    expect(router.page()).toBe('runtime');
  });
});

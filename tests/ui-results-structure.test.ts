// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Structure locks for the two UI modules that had grown past 1.6k lines.
 *
 * These are source-level assertions, matching `ui-modal-shell.test.ts`: the
 * point is to stop a refactor being quietly undone by inlining the subpages
 * back into the parent. They also pin the Watchlist quote lifecycle that its
 * own module docs promise ("panel closed → no REST poll").
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const lines = (rel: string) => read(rel).split('\n').length;

describe('Results overlay is split into subpages', () => {
  it('keeps the modal shell under a reviewable size', () => {
    // Was 1,677 lines with all six subpages inlined. Budget: 900.
    expect(lines('src/ui/ResultsModal.tsx')).toBeLessThan(900);
  });

  it('renders the Events and Saved subpages as components', () => {
    const src = read('src/ui/ResultsModal.tsx');
    expect(src).toContain("from './results/EventsTab'");
    expect(src).toContain("from './results/SavedTab'");
    expect(src).toContain('<EventsTab');
    expect(src).toContain('<SavedTab');
  });

  it('exports the subpage components', () => {
    expect(read('src/ui/results/EventsTab.tsx')).toContain('export function EventsTab(');
    expect(read('src/ui/results/SavedTab.tsx')).toContain('export function SavedTab(');
    expect(read('src/ui/results/Sparkline.tsx')).toContain('export function Sparkline(');
  });

  it('keeps the formatting helpers Solid-free so they stay unit-testable', () => {
    const src = read('src/ui/results/format.ts');
    expect(src).not.toContain("from 'solid-js'");
    expect(src).toContain('export function formatEventTime(');
    expect(src).toContain('export function readSavedStats(');
  });

  it('stays out of the initial bundle', () => {
    const app = read('src/app.tsx');
    // The overlay is a full studio page: lazy, and mounted only when opened.
    expect(app).toContain("import('./ui/ResultsModal')");
    expect(app).not.toMatch(/^import \{ ResultsModal \} from '\.\/ui\/ResultsModal';$/m);
    expect(app).toMatch(
      /<Show when=\{store\.resultsPanel\.open\}>\s*<Suspense fallback=\{null\}>\s*<ResultsModal \/>/,
    );
  });

  it('replays a tab request that arrived before the overlay mounted', () => {
    const src = read('src/ui/ResultsModal.tsx');
    expect(src).toContain('takePendingResultsTab');
    expect(src).toContain('onResultsTabRequest');
    // The ad-hoc window listener that a lazy mount would miss is gone.
    expect(src).not.toContain("window.addEventListener('axis-results-tab'");
  });
});

describe('Alerts panel is split into a list and a row', () => {
  it('renders the row as a component', () => {
    const src = read('src/ui/AlertsPanel.tsx');
    expect(src).toContain("from './alerts/AlertRow'");
    expect(src).toContain('<AlertRow');
    expect(read('src/ui/alerts/AlertRow.tsx')).toContain('export const AlertRow');
  });

  it('keeps the panel under a reviewable size', () => {
    // Was 1,409 lines with the row markup inlined. Budget: 1,350.
    expect(lines('src/ui/AlertsPanel.tsx')).toBeLessThan(1350);
  });
});

describe('Watchlist stays out of the initial bundle', () => {
  it('is lazy and mounted only while open', () => {
    const app = read('src/app.tsx');
    expect(app).toContain("import('./ui/Watchlist')");
    expect(app).not.toMatch(/^import \{ Watchlist \} from '\.\/ui\/Watchlist';$/m);
    expect(app).toMatch(
      /<Show when=\{isPanelOpen\('watchlist'\) \|\| store\.watchlist\.open\}>\s*<Suspense fallback=\{null\}>\s*<Watchlist \/>/,
    );
  });
});

describe('Watchlist quote lifecycle', () => {
  const src = () => read('src/ui/Watchlist.tsx');

  it('gates the daily-close seed on panel visibility', () => {
    // `loadDailyCloses` must refuse to fetch while the panel is closed.
    expect(src()).toMatch(
      /const loadDailyCloses = async \(\) => \{\s*\n\s*if \(dailyDisposed \|\| !panelOpen\(\)\) return;/,
    );
  });

  it('does not seed daily closes unconditionally from onMount', () => {
    const mount = src().slice(src().indexOf('onMount(() => {'));
    const body = mount.slice(0, mount.indexOf('\n  });'));
    // The bug shape was a bare `void load();` as the first statement. Every
    // remaining call inside onMount (interval, focus) is panel-gated inline.
    expect(body).not.toMatch(/^\s*void load(DailyCloses)?\(\);\s*$/m);
    expect(body).toContain('if (!panelOpen()) return;');
    expect(body).toContain('if (panelOpen() && dailyCloseDayKey() !== dailyDay())');
  });

  it('seeds on open through a dedicated effect', () => {
    expect(src()).toMatch(/createEffect\(\(\) => \{\s*\n\s*if \(!panelOpen\(\)\) return;/);
  });

  it('has exactly one panel-open predicate', () => {
    const occurrences =
      src().match(/isPanelOpen\('watchlist'\) \|\| store\.watchlist\.open/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(src()).toContain('const panelOpen = () =>');
  });
});

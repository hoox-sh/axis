// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Status-bar HUD inspector: click/keyboard only. Hover never opens a container.
 * Compact = classic scanline; expanded = measured latency / network / app perf.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reduceHudInspector } from '../src/ui/hud-model';
import { latencySampleStats } from '../src/ui/telemetry';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('reduceHudInspector', () => {
  it('opens a chip on toggle from closed', () => {
    expect(reduceHudInspector(null, { type: 'toggle', id: 'live' })).toBe('live');
  });

  it('closes the same chip on a second toggle', () => {
    expect(reduceHudInspector('live', { type: 'toggle', id: 'live' })).toBe(null);
  });

  it('switches chips without a hover step', () => {
    expect(reduceHudInspector('live', { type: 'toggle', id: 'tick' })).toBe('tick');
  });

  it('close always clears', () => {
    expect(reduceHudInspector('eng', { type: 'close' })).toBe(null);
    expect(reduceHudInspector(null, { type: 'close' })).toBe(null);
  });
});

describe('latencySampleStats', () => {
  it('returns nulls for an empty window', () => {
    expect(latencySampleStats([])).toEqual({
      n: 0,
      last: null,
      p50: null,
      p95: null,
      max: null,
    });
  });

  it('reports last / p50 / p95 / max over samples', () => {
    const stats = latencySampleStats([10, 20, 30, 40, 100]);
    expect(stats.n).toBe(5);
    expect(stats.last).toBe(100);
    expect(stats.p50).toBe(30);
    expect(stats.p95).toBe(100);
    expect(stats.max).toBe(100);
  });
});

describe('scanline source contract', () => {
  it('ConnectionHud has no hover-open inspector', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).not.toContain('onMouseEnter');
    expect(src).not.toContain('onMouseLeave');
    expect(src).not.toContain('scheduleClose');
    expect(src).not.toContain('useStickyInfo');
    expect(src).not.toContain('hover bridge');
    expect(src).not.toContain('axis-hud-pin');
    expect(src).not.toContain('Hover for info');
    expect(src).not.toContain('getBoundingClientRect');
  });

  it('ConnectionHud Last and Live follow current symbol and stream arm', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).toContain('lastTickForSymbol');
    expect(src).toContain('readLiveArm');
    expect(src).toContain('displayedLastPrice');
  });

  it('ConnectionHud click-opens the shared Popover above the rail', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).toContain("from './Popover'");
    expect(src).toContain('side="top"');
    expect(src).toContain('reduceHudInspector');
    expect(src).toContain('role="dialog"');
    expect(src).toContain('axis-hud-info');
    expect(src).toContain('Click a chip for details');
  });

  it('StatusBar documents the classic scanline and collapse control', () => {
    const src = read('src/ui/StatusBar.tsx');
    expect(src).toMatch(/scanline/i);
    expect(src).toContain('never hover');
    expect(src).toContain('data-testid="axis-statusbar"');
    expect(src).toContain('data-testid="axis-statusbar-bars"');
    expect(src).toContain('data-testid="axis-statusbar-dataset"');
    expect(src).toContain('data-testid="axis-statusbar-collapse"');
    expect(src).toContain("setStore('telemetry', 'hud', 'compact'");
    expect(src).toContain('data-compact');
    expect(src).toContain('classic scanline');
    expect(src).toContain('when={compact()}');
  });

  it('ConnectionHud compact is classic scanline; expanded is measured perf', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).toContain('hud?.compact');
    expect(src).toContain('when={compact()}');
    expect(src).toContain('when={!compact()}');
    expect(src).toContain('axis-hud-perf');
    expect(src).toContain('paintLatencyStats');
    expect(src).toContain('latencySampleStats');
    expect(src).toContain('axis-hud-metric');
    expect(src).toContain('metric="live"');
    expect(src).toContain('metric="last"');
    expect(src).toContain('kind="compose"');
    expect(src).toContain('kind="diag"');
    expect(src).not.toContain('Live + Last only');
  });

  it('Popover can pin above the anchor', () => {
    const src = read('src/ui/Popover.tsx');
    expect(src).toContain("side?: 'top' | 'bottom'");
    expect(src).toContain("props.side === 'top'");
  });

  it('Settings labels match classic compact + diagnostics', () => {
    const src = read('src/ui/settings/SettingsPage.tsx');
    expect(src).toContain('Compact status bar');
    expect(src).toContain('Classic scanline (Live, Last, Compose, bars)');
    expect(src).toContain('axis-settings-hud-compact');
    expect(src).toContain('axis-settings-hud-diagnostics');
    expect(src).toContain('On the classic scanline');
    expect(src).not.toContain('Collapse to Live + Last only');
    expect(src).not.toContain('When the bar is expanded, show engine');
  });

  it('CSS metric icons respect prefers-reduced-motion', () => {
    const css = read('src/index.css');
    expect(css).toContain('axis-hud-metric--live');
    expect(css).toContain('axis-hud-metric--last');
    expect(css).toContain('axis-hud-metric--compose');
    expect(css).toContain('axis-hud-metric--diag');
    expect(css).toContain('axis-statusbar-collapse');
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*axis-hud-metric--live[\s\S]*animation:\s*none/,
    );
  });

  it('store defaults compact to classic scanline', () => {
    const src = read('src/store/index.ts');
    expect(src).toContain('hud: { compact: true, overlay: false, diagnostics: false }');
    expect(src).not.toContain('hud: { compact: false, overlay: false, diagnostics: false }');
  });
});

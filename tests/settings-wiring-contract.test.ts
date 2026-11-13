// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings must actually reach the chart.
 *
 * Audit result (2026-11): most settings are wired, but three surfaces had
 * drifted apart.
 *
 * - **Label toggles** were fine: `ChartScaleControls` has reactive effects that
 *   push them to the manager. Its `onMount` and `ChartHost` both duplicated the
 *   same three calls, which is what `applyLabelPrefsToChart` now owns.
 * - **Fill-display toggles** were not fine: they are read when markers are
 *   *built*, and only Results → Strategy repainted. Settings wrote the store and
 *   left stale markers until the next run.
 * - **Status-bar toggles** wrote + flushed on change inside a Save/Cancel tab,
 *   so Cancel could not undo them.
 *
 * This is a source-level lock, matching `ui-modal-shell.test.ts`; the behaviour
 * is covered by `settings-chart-wiring.test.ts` and `e2e/settings-cancel.spec.ts`.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('label preferences', () => {
  it('has one applier for the three prefs', () => {
    const mod = read('src/chart/label-prefs.ts');
    expect(mod).toContain('export function applyLabelPrefsToChart(');
    expect(mod).toContain('setPriceScaleLabelsVisible');
    expect(mod).toContain('setLastValueLabelsVisible');
    expect(mod).toContain('setLastValueNamesVisible');
  });

  it('is used by the mount paths instead of hand-copied calls', () => {
    for (const rel of ['src/chart/ChartHost.tsx', 'src/chart/ChartScaleControls.tsx']) {
      expect(read(rel)).toContain('applyLabelPrefsToChart');
    }
  });

  it('keeps the reactive path in ChartScaleControls', () => {
    // This is what makes Settings → Chart labels apply live. Losing it would
    // re-introduce the "Save looks like a no-op" symptom.
    const src = read('src/chart/ChartScaleControls.tsx');
    expect(src).toMatch(/createEffect\(\(\) => \{\s*const want = store\.priceScaleLabelsVisible/);
    expect(src).toMatch(/createEffect\(\(\) => \{\s*const want = store\.lastValueLabelsVisible/);
    expect(src).toMatch(/createEffect\(\(\) => \{\s*const want = store\.lastValueNamesVisible/);
  });
});

describe('fill-display preferences repaint existing markers', () => {
  it('Settings saves repaint markers', () => {
    expect(read('src/ui/settings/SettingsPage.tsx')).toContain('reapplyTradeMarkersFromStore');
  });

  it('Results and Settings share one repaint', () => {
    const modal = read('src/ui/ResultsModal.tsx');
    expect(modal).toContain('reapplyTradeMarkersFromStore');
    expect(modal).not.toContain('mgr.setTradeMarkers(markers');
  });
});

describe('General is a Save/Cancel tab', () => {
  it('does not persist status-bar toggles on change', () => {
    const src = read('src/ui/settings/SettingsPage.tsx');
    const hudToggles = src.slice(src.indexOf('title="Status HUD"'));
    expect(hudToggles).not.toContain("setStore('telemetry', 'hud', 'compact', v)");
    expect(hudToggles).not.toContain("setStore('telemetry', 'hud', 'diagnostics', v)");
  });

  it('still persists them on Save', () => {
    const src = read('src/ui/settings/SettingsPage.tsx');
    expect(src).toContain("setStore('telemetry', 'hud', 'compact', hudCompact())");
    expect(src).toContain("setStore('telemetry', 'hud', 'diagnostics', hudDiagnostics())");
  });
});

describe('settings tabs match their contents', () => {
  const src = () => read('src/ui/settings/SettingsPage.tsx');

  it('keeps storage, cloud/MCP and on-chain on the Data tab', () => {
    const dataTab = src().slice(
      src().indexOf('id="data" active'),
      src().indexOf('id="editor" active'),
    );
    expect(dataTab).toContain('title="Script library"');
    expect(dataTab).toContain('title="Cloud Worker & MCP"');
    expect(dataTab).toContain('title="On-Chain"');
  });

  it('does not leave them on General', () => {
    const general = src().slice(
      src().indexOf('id="general" active'),
      src().indexOf('id="data" active'),
    );
    expect(general).not.toContain('title="Script library"');
    expect(general).not.toContain('title="Cloud Worker & MCP"');
    expect(general).not.toContain('title="On-Chain"');
  });
});

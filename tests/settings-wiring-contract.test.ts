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
  const tab = (id: string) => {
    const from = src().indexOf(`id="${id}" active`);
    const next = src().indexOf('<SettingsTabPanel id="', from + 10);
    return src().slice(from, next === -1 ? undefined : next);
  };

  it('keeps storage and connectivity on their own tab', () => {
    const storage = tab('storage');
    expect(storage).toContain('title="Script library"');
    expect(storage).toContain('title="Cloud Worker & MCP"');
  });

  it('keeps market-data concerns on Data', () => {
    const data = tab('data');
    expect(data).toContain('title="Dataset cache"');
    expect(data).toContain('title="Source & stream"');
    expect(data).not.toContain('title="Script library"');
    expect(data).not.toContain('title="Cloud Worker & MCP"');
  });

  it('does not leave storage or cloud on General', () => {
    const general = tab('general');
    expect(general).not.toContain('title="Script library"');
    expect(general).not.toContain('title="Cloud Worker & MCP"');
  });

  it('has no On-Chain pseudo-setting (it is a panel shortcut, not a preference)', () => {
    expect(src()).not.toContain('title="On-Chain"');
    expect(src()).not.toContain('axis-settings-onchain');
  });

  it('labels the interval control for what it does', () => {
    // It sets the live interval and reloads the symbol; "Default" was wrong.
    expect(src()).toContain('label="Chart interval"');
    expect(src()).not.toContain('label="Default interval"');
  });

  it('applies a storage switch immediately (that tab has no Save)', () => {
    const storage = tab('storage');
    expect(storage).toContain('promptStorageChange(getActiveStorageId(), id)');
  });

  it('declares the storage tab everywhere it is validated', () => {
    expect(read('src/ui/studio/types.ts')).toContain("'storage'");
    expect(src()).toContain("{ id: 'storage', label: 'Storage'");
  });
});

describe('cross-references point at a tab that exists', () => {
  /** Every user-facing pointer must name a real tab, not a section that moved. */
  const STALE = [
    'Settings → General → Worker',
    'Settings → MCP',
    'Settings → Script storage',
    'Settings → General → Debug logs',
    'Data tab is exchange credentials only',
  ];

  it('has no pointer to a section that moved', () => {
    const files = [
      'src/mcp/bridge.ts',
      'src/mcp/host.ts',
      'src/mcp/protocol.ts',
      'src/storage/cloud.ts',
      'src/ui/McpHud.tsx',
      'src/debug.ts',
      'src/ui/debug/DebugPage.tsx',
      'docs/enduser/guides/mcp.mdx',
      'docs/enduser/guides/troubleshooting.mdx',
      'docs/enduser/reference/faq.mdx',
      'docs/enduser/guides/manager-and-settings.mdx',
    ];
    for (const rel of files) {
      const src = read(rel);
      for (const stale of STALE) {
        expect({ rel, stale, hit: src.includes(stale) }).toEqual({ rel, stale, hit: false });
      }
    }
  });

  it('sends the MCP key path to the Storage tab', () => {
    expect(read('src/mcp/host.ts')).toContain("detail: { tab: 'storage' }");
    expect(read('src/ui/McpHud.tsx')).toContain("detail: { tab: 'storage' }");
  });

  it('opens the tab the event asks for', () => {
    const app = read('src/app.tsx');
    expect(app).toContain('isSettingsTabId(tab) ? tab : \'general\'');
  });
});

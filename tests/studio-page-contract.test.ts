/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Source locks for the studio split (7411086f).
 *
 * - Workers is a read-only inventory: it probes, but it does not activate a
 *   Runtime engine, warm the compiler, manage hosted jobs, or edit the agent.
 * - Opening Workers and Refresh probe the selected card only.
 * - Settings labels the source tab "Source"; its Open Data button, the topbar
 *   Data button, and the status-bar dataset count open the rail Data page.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** The `<button>...</button>` block that carries `testId`. */
function buttonBlock(src: string, testId: string): string {
  const at = src.indexOf(testId);
  expect(at).toBeGreaterThan(-1);
  const open = src.lastIndexOf('<button', at);
  const close = src.indexOf('</button>', at);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(at);
  return src.slice(open, close);
}

describe('Workers inventory is read-only', () => {
  it('has no engine, compiler, hosted-job, or agent write path', () => {
    const page = read('src/ui/workers/WorkersPage.tsx');
    const forbidden = [
      'saveEngineConfig',
      'writeLiveEngine',
      'setActivePlugin',
      'prewarmEngine',
      'preloadPyodide',
      'listHostedJobs',
      'setHostedJobEnabled',
      'runHostedJobNow',
      'deployHostedScript',
      'loadPluginFromUrl',
      'writePluginField',
    ];
    for (const token of forbidden) {
      expect({ token, present: page.includes(token) }).toEqual({ token, present: false });
    }
    // The agent card points at Plugins instead of installing or editing here.
    expect(page).toContain('Open Plugins to install');
    expect(page).not.toContain('Install agent plugin');
  });

  it('hides optional workers until Show optional is on', () => {
    const page = read('src/ui/workers/WorkersPage.tsx');
    expect(page).toContain('const [showOptional, setShowOptional] = createSignal(false);');
    expect(page).toContain('if (showOptional()) return all;');
    expect(page).toContain('return all.filter((w) => !w.optional);');
    expect(page).toContain('label="Show optional workers"');
  });
});

describe('Workers probes the selected card only', () => {
  it('refreshes the selected worker, not the whole catalog', () => {
    const page = read('src/ui/workers/WorkersPage.tsx');
    expect(page).toContain('const r = await probeWorker(id, { timeoutMs: 5000 });');
    expect(page).toContain('void refreshOne(selectedId());');
    expect(page).toContain('onClick={() => void refreshOne(selectedId())}');
    expect(page).toContain('title="Probe the selected worker"');
    expect(page).not.toContain('probeAllWorkers');
  });
});

describe('Settings Source tab and Data shortcuts', () => {
  it('labels the data tab Source', () => {
    const page = read('src/ui/settings/SettingsPage.tsx');
    expect(page).toMatch(/id:\s*'data',\s*label:\s*'Source'/);
    expect(page).not.toMatch(/id:\s*'data',\s*label:\s*'Data'/);
  });

  it('Settings Open Data opens the studio Data page', () => {
    const page = read('src/ui/settings/SettingsPage.tsx');
    const at = page.indexOf('testId="axis-settings-open-dsm"');
    expect(at).toBeGreaterThan(-1);
    const button = page.slice(at, page.indexOf('</AppButton>', at));
    expect(button).toContain("new CustomEvent('axis-open-studio', { detail: { page: 'data' } })");
    expect(button).toContain('Open Data');
    expect(page).not.toContain('toggleDataSourcePanel');
  });

  it('topbar Data and status-bar dataset open the same page', () => {
    const topbar = buttonBlock(read('src/ui/Topbar.tsx'), 'axis-btn-datasource');
    expect(topbar).toContain("new CustomEvent('axis-open-studio', { detail: { page: 'data' } })");
    const status = buttonBlock(read('src/ui/StatusBar.tsx'), 'axis-statusbar-dataset');
    expect(status).toContain("new CustomEvent('axis-open-studio', { detail: { page: 'data' } })");
  });

  it('routes page=data to DsmPage, which owns cache and backfill', () => {
    expect(read('src/app.tsx')).toContain("page === 'data'");
    expect(read('src/ui/studio/StudioHost.tsx')).toMatch(
      /props\.page === 'data'[\s\S]{0,80}<DsmPage/,
    );
    const dsm = read('src/ui/dsm/DsmPage.tsx');
    expect(dsm).toContain("label: 'Datasets'");
    expect(dsm).toContain("label: 'Backfill jobs'");
  });
});

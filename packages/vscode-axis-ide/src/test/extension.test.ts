// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { RUN_NO_PINE_MESSAGE, RUN_OUTPUT_CHANNEL_NAME } from '../constants';
import { CHART_VIEW_TYPE } from '../editors/chart-document';
import { OPEN_CHART_NO_PINE_MESSAGE } from '../host/open-chart';
import { isVersionOlderThan } from '../semver';

const PACKAGE_PATH = path.resolve(__dirname, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')) as {
  name: string;
  publisher: string;
  displayName: string;
  version: string;
  license: string;
  icon?: string;
  activationEvents?: string[];
  extensionDependencies?: string[];
  contributes?: Record<string, unknown> & {
    commands?: Array<{ command: string }>;
    customEditors?: Array<{
      viewType: string;
      displayName?: string;
      selector?: Array<{ filenamePattern: string }>;
      priority?: string;
    }>;
    viewsContainers?: {
      panel?: Array<{ id: string; title?: string; icon?: string }>;
      activitybar?: Array<{ id: string; title?: string; icon?: string }>;
    };
    views?: Record<
      string,
      Array<{
        id: string;
        name?: string;
        type?: string;
        retainContextWhenHidden?: boolean;
      }>
    >;
    configuration?:
      | Array<{ properties: Record<string, unknown> }>
      | { properties: Record<string, unknown> };
  };
};

/** Exact contribute inventory — expand only when package.json contributes grow (KD-14). */
const EXPECTED_COMMANDS = [
  'axis.showRunOutput',
  'axis.openChart',
  'axis.runScript',
  'axis.runScriptSilent',
  'axis.focusResults',
  'axis.secrets.setWorkerKey',
  'axis.secrets.setProKey',
  'axis.secrets.clear',
  'axis.applyBuiltin',
  'axis.liveStart',
  'axis.liveStop',
  'axis.workers.probeAll',
  'axis.plugins.activate',
  'axis.plugins.statusMenu',
  'axis.alerts.add',
  'axis.alerts.remove',
  'axis.watchlist.add',
  'axis.watchlist.remove',
  'axis.chart.drawing.trendline',
  'axis.mcp.showConfig',
] as const;
const EXPECTED_SETTINGS = [
  'axis.telemetry.offline',
  'axis.engine.id',
  'axis.engine.endpoint',
  'axis.engine.allowRemoteEndpoint',
  'axis.engine.allowPyodide',
  'axis.chart.historyBars',
  'axis.chart.useMockBars',
  'axis.datafeed.url',
  'axis.worker.url',
  'axis.live.enabled',
  'axis.plugins.allowUrlInstall',
  'axis.mcp.stdio',
  'axis.mcp.command',
  'axis.mcp.allowNpx',
] as const;
/** Must never appear as contributes.configuration — SecretStorage only (KD-8). */
const FORBIDDEN_SETTINGS = ['axis.worker.apiKey', 'axis.pro.apiKey'] as const;
const EXPECTED_WORKSPACE_CONTAINS = [
  'workspaceContains:**/*.axis.json',
  'workspaceContains:**/*.pyne',
  'workspaceContains:**/*.pine',
  'workspaceContains:**/*.pinev5',
  'workspaceContains:**/*.pinev6',
  'workspaceContains:**/*.pinescript',
] as const;
const ALLOWED_CONTRIBUTE_KEYS = new Set([
  'commands',
  'configuration',
  'customEditors',
  'menus',
  'keybindings',
  'viewsContainers',
  'views',
  'mcpServerDefinitionProviders',
  'languageModelTools',
]);
const EXPECTED_MCP_PROVIDERS = [{ id: 'axis.mcp', label: 'AXIS MCP' }] as const;
const EXPECTED_LM_TOOLS = [
  'axis_run_script',
  'axis_get_results_focus',
  'axis_chart_snapshot_meta',
] as const;
const EXPECTED_PANEL_VIEWS = ['axis.results', 'axis.strategy'] as const;
const EXPECTED_ACTIVITY_VIEWS = [
  'axis.library',
  'axis.layers',
  'axis.indicators',
  'axis.watchlist',
  'axis.alerts',
  'axis.plugins',
  'axis.workers',
] as const;
const FORBIDDEN_PLUGIN_KIND_VIEWS = [
  'axis.plugins.source',
  'axis.plugins.stream',
  'axis.plugins.engine',
  'axis.plugins.storage',
  'axis.plugins.dataset',
  'axis.plugins.component',
] as const;
const ACTIVITY_ICON = 'media/axis-activity.svg';
const EXPECTED_KEYBINDINGS = [
  {
    command: 'axis.runScript',
    key: 'ctrl+enter',
    mac: 'cmd+enter',
    when: 'editorTextFocus && editorLangId == pinescript',
  },
] as const;
const EXPECTED_CUSTOM_EDITORS = [
  {
    viewType: CHART_VIEW_TYPE,
    displayName: 'AXIS Chart',
    filenamePattern: '*.axis.json',
    priority: 'default',
  },
] as const;

const PYNE_EXT_ID = 'hoox-sh.pyne';
const PYNE_RECOMMENDED_MIN = '0.5.4';

suite('AXIS IDE Extension Structure', () => {
  test('package.json identity', () => {
    assert.strictEqual(pkg.name, 'axis-ide');
    assert.strictEqual(pkg.publisher, 'hoox-sh');
    assert.strictEqual(pkg.displayName, 'AXIS IDE');
    assert.strictEqual(pkg.license, 'AGPL-3.0-only');
    assert.ok(pkg.version.startsWith('0.1'));
    assert.ok(pkg.icon, 'package.json must declare icon');
    assert.ok(
      fs.existsSync(path.resolve(__dirname, '../../', pkg.icon)),
      `icon missing on disk: ${pkg.icon}`,
    );
  });

  test('extensionDependencies includes hoox-sh.pyne (id-only)', () => {
    const deps = pkg.extensionDependencies ?? [];
    assert.ok(deps.includes(PYNE_EXT_ID), `Missing ${PYNE_EXT_ID}`);
    for (const id of deps) {
      assert.ok(!/[<>=]/.test(id), `extensionDependencies must be id-only, got: ${id}`);
    }
  });

  test('activationEvents: no onStartupFinished; onCommand + onCustomEditor + workspaceContains', () => {
    const events = pkg.activationEvents ?? [];
    assert.ok(!events.includes('onStartupFinished'), 'must not use onStartupFinished');
    assert.ok(
      events.includes(`onCustomEditor:${CHART_VIEW_TYPE}`),
      `missing onCustomEditor:${CHART_VIEW_TYPE}`,
    );
    for (const id of EXPECTED_COMMANDS) {
      assert.ok(
        events.includes(`onCommand:${id}`),
        `missing onCommand activation for ${id}`,
      );
    }
    for (const glob of EXPECTED_WORKSPACE_CONTAINS) {
      assert.ok(events.includes(glob), `missing activationEvent ${glob}`);
    }
  });

  test('contributes customEditors axis.chart for *.axis.json (KD-4)', () => {
    assert.strictEqual(CHART_VIEW_TYPE, 'axis.chart');
    const editors = pkg.contributes?.customEditors ?? [];
    assert.strictEqual(editors.length, EXPECTED_CUSTOM_EDITORS.length);
    for (const expected of EXPECTED_CUSTOM_EDITORS) {
      const found = editors.find((e) => e.viewType === expected.viewType);
      assert.ok(found, `missing customEditor ${expected.viewType}`);
      assert.strictEqual(found?.displayName, expected.displayName);
      assert.strictEqual(found?.priority, 'default');
      const patterns = (found?.selector ?? []).map((s) => s.filenamePattern);
      assert.deepStrictEqual(
        patterns,
        [expected.filenamePattern],
        `${expected.viewType} selector must be exactly ${expected.filenamePattern}`,
      );
    }
  });

  test('contributes panel + activity views (results/strategy/library/layers/indicators/watchlist/alerts/plugins/workers)', () => {
    const panelContainers = pkg.contributes?.viewsContainers?.panel ?? [];
    const axisPanel = panelContainers.find((c) => c.id === 'axis-panel');
    assert.ok(axisPanel, 'missing viewsContainers.panel axis-panel');
    assert.strictEqual(axisPanel?.title, 'AXIS');
    assert.strictEqual(axisPanel?.icon, ACTIVITY_ICON);

    const activity = pkg.contributes?.viewsContainers?.activitybar ?? [];
    const axisBar = activity.find((c) => c.id === 'axis');
    assert.ok(axisBar, 'missing viewsContainers.activitybar axis (merged from trees fragment)');
    assert.strictEqual(axisBar?.icon, ACTIVITY_ICON);

    const iconAbs = path.resolve(__dirname, '../../', ACTIVITY_ICON);
    assert.ok(fs.existsSync(iconAbs), `activity icon missing on disk: ${ACTIVITY_ICON}`);
    const svg = fs.readFileSync(iconAbs, 'utf8');
    assert.ok(
      svg.includes('m 1024.04,675.876'),
      'activity icon must keep the HOOX geometric path',
    );
    assert.ok(svg.includes('aria-label="HOOX"'), 'activity icon must label HOOX');

    const panelViews = pkg.contributes?.views?.['axis-panel'] ?? [];
    const panelIds = panelViews.map((v) => v.id);
    for (const id of EXPECTED_PANEL_VIEWS) {
      assert.ok(panelIds.includes(id), `missing panel view ${id}`);
      const entry = panelViews.find((v) => v.id === id);
      assert.strictEqual(entry?.type, 'webview', `${id} must be type webview`);
    }

    const sideViews = pkg.contributes?.views?.axis ?? [];
    const sideIds = sideViews.map((v) => v.id);
    assert.deepStrictEqual(
      sideIds,
      [...EXPECTED_ACTIVITY_VIEWS],
      'activity view inventory/order drifted — update test when intentionally expanding contributes',
    );
    const pluginsView = sideViews.find((v) => v.id === 'axis.plugins');
    assert.strictEqual(pluginsView?.type, 'webview', 'axis.plugins must be type webview');
    assert.strictEqual(
      pluginsView?.retainContextWhenHidden,
      true,
      'axis.plugins must retainContextWhenHidden',
    );
    for (const id of FORBIDDEN_PLUGIN_KIND_VIEWS) {
      assert.ok(!sideIds.includes(id), `split plugin TreeView ${id} must be gone`);
    }

    const activation = pkg.activationEvents ?? [];
    assert.ok(
      activation.includes('onView:axis.plugins'),
      'activationEvents should include onView:axis.plugins',
    );
    assert.ok(
      activation.includes('onView:axis.results'),
      'activationEvents should include onView:axis.results',
    );
    assert.ok(
      activation.includes('onView:axis.strategy'),
      'activationEvents should include onView:axis.strategy',
    );
    for (const id of FORBIDDEN_PLUGIN_KIND_VIEWS) {
      assert.ok(
        !activation.includes(`onView:${id}`),
        `activationEvents must not include onView:${id}`,
      );
    }
    assert.ok(
      activation.includes('onCommand:axis.plugins.activate'),
      'activationEvents should include onCommand:axis.plugins.activate',
    );
    assert.ok(
      activation.includes('onCommand:axis.plugins.statusMenu'),
      'activationEvents should include onCommand:axis.plugins.statusMenu',
    );
    assert.ok(
      activation.includes('onView:axis.workers'),
      'activationEvents should include onView:axis.workers',
    );
    assert.ok(
      activation.includes('onView:axis.watchlist'),
      'activationEvents should include onView:axis.watchlist',
    );
    assert.ok(
      activation.includes('onView:axis.alerts'),
      'activationEvents should include onView:axis.alerts',
    );
  });

  test('contributes expected commands (KD-14 inventory)', () => {
    const commandIds = (pkg.contributes?.commands ?? []).map((c) => c.command);
    for (const id of EXPECTED_COMMANDS) {
      assert.ok(commandIds.includes(id), `Missing command: ${id}`);
    }
    assert.deepStrictEqual(
      [...commandIds].sort(),
      [...EXPECTED_COMMANDS].sort(),
      'command inventory drifted — update test when intentionally expanding contributes',
    );
  });

  test('contributes only allowed settings (no SecretStorage keys as config)', () => {
    const configuration = Array.isArray(pkg.contributes?.configuration)
      ? pkg.contributes.configuration
      : pkg.contributes?.configuration
        ? [pkg.contributes.configuration]
        : [];
    const settings = configuration.flatMap((group) => Object.keys(group.properties ?? {}));
    for (const key of EXPECTED_SETTINGS) {
      assert.ok(settings.includes(key), `Missing setting: ${key}`);
    }
    for (const key of FORBIDDEN_SETTINGS) {
      assert.ok(
        !settings.includes(key),
        `${key} must not be a configuration property — use axis.secrets.* → SecretStorage`,
      );
    }
    assert.deepStrictEqual(
      [...settings].sort(),
      [...EXPECTED_SETTINGS].sort(),
      'setting inventory drifted',
    );
  });

  test('contributes keys stay on the allowlist (incl. views / viewsContainers)', () => {
    const keys = Object.keys(pkg.contributes ?? {});
    for (const key of keys) {
      assert.ok(
        ALLOWED_CONTRIBUTE_KEYS.has(key),
        `unexpected contributes.${key} — allowed: ${[...ALLOWED_CONTRIBUTE_KEYS].join('/')}`,
      );
    }
  });

  test('keybinding ctrl/cmd+enter → axis.runScript for pinescript', () => {
    const keybindings = (
      pkg.contributes as {
        keybindings?: Array<{ command: string; key?: string; mac?: string; when?: string }>;
      }
    )?.keybindings ?? [];
    assert.strictEqual(keybindings.length, EXPECTED_KEYBINDINGS.length);
    for (const expected of EXPECTED_KEYBINDINGS) {
      const found = keybindings.find((k) => k.command === expected.command);
      assert.ok(found, `missing keybinding for ${expected.command}`);
      assert.strictEqual(found?.key, expected.key);
      assert.strictEqual(found?.mac, expected.mac);
      assert.strictEqual(found?.when, expected.when);
    }
  });

  test('editor/title menu includes openChart + runScript for pinescript', () => {
    const menus = (pkg.contributes as { menus?: Record<string, Array<{ command: string; when?: string }>> })
      ?.menus;
    const title = menus?.['editor/title'] ?? [];
    const open = title.find((e) => e.command === 'axis.openChart');
    assert.ok(open, 'editor/title must contribute axis.openChart');
    assert.strictEqual(open?.when, 'resourceLangId == pinescript');
    const run = title.find((e) => e.command === 'axis.runScript');
    assert.ok(run, 'editor/title must contribute axis.runScript');
    assert.strictEqual(run?.when, 'resourceLangId == pinescript');
  });

  test('commandPalette includes axis.runScriptSilent for pinescript', () => {
    const menus = (pkg.contributes as { menus?: Record<string, Array<{ command: string; when?: string }>> })
      ?.menus;
    const palette = menus?.commandPalette ?? [];
    const silent = palette.find((e) => e.command === 'axis.runScriptSilent');
    assert.ok(silent, 'commandPalette must contribute axis.runScriptSilent');
    assert.strictEqual(silent?.when, 'editorLangId == pinescript');
  });

  test('commandPalette shows axis.plugins.statusMenu (not when:false)', () => {
    const menus = (pkg.contributes as { menus?: Record<string, Array<{ command: string; when?: string }>> })
      ?.menus;
    const palette = menus?.commandPalette ?? [];
    const hiddenActivate = palette.find((e) => e.command === 'axis.plugins.activate');
    assert.ok(hiddenActivate, 'commandPalette must contribute axis.plugins.activate');
    assert.strictEqual(hiddenActivate?.when, 'false');
    const statusMenu = palette.find((e) => e.command === 'axis.plugins.statusMenu');
    assert.ok(statusMenu, 'commandPalette must contribute axis.plugins.statusMenu');
    assert.ok(
      statusMenu?.when !== 'false',
      'axis.plugins.statusMenu must stay visible in the command palette',
    );
  });

  test('contributes MCP provider + languageModelTools (KD-9 / Task 21–22)', () => {
    const providers = (
      pkg.contributes as {
        mcpServerDefinitionProviders?: Array<{ id: string; label?: string }>;
      }
    )?.mcpServerDefinitionProviders ?? [];
    assert.strictEqual(providers.length, EXPECTED_MCP_PROVIDERS.length);
    for (const expected of EXPECTED_MCP_PROVIDERS) {
      const found = providers.find((p) => p.id === expected.id);
      assert.ok(found, `missing mcpServerDefinitionProvider ${expected.id}`);
      assert.strictEqual(found?.label, expected.label);
    }

    const tools = (
      pkg.contributes as {
        languageModelTools?: Array<{ name: string }>;
      }
    )?.languageModelTools ?? [];
    const names = tools.map((t) => t.name);
    for (const id of EXPECTED_LM_TOOLS) {
      assert.ok(names.includes(id), `missing languageModelTool ${id}`);
    }
    assert.deepStrictEqual(
      [...names].sort(),
      [...EXPECTED_LM_TOOLS].sort(),
      'languageModelTools inventory drifted',
    );
  });
});

suite('AXIS IDE Extension Activation', () => {
  test('activates and registers commands including axis.secrets.*', async () => {
    const ext = vscode.extensions.getExtension('hoox-sh.axis-ide');
    assert.ok(ext, 'hoox-sh.axis-ide should load under extensionDevelopmentPath');
    await ext.activate();
    assert.ok(ext.isActive);

    const commands = await vscode.commands.getCommands(true);
    for (const id of EXPECTED_COMMANDS) {
      assert.ok(commands.includes(id), `Command not registered: ${id}`);
    }
  });

  test('axis.showRunOutput shows AXIS Run channel', async () => {
    const result = await vscode.commands.executeCommand('axis.showRunOutput');
    assert.strictEqual(result, RUN_OUTPUT_CHANNEL_NAME);
  });

  test('axis.openChart without active Pine returns clear error (no await UI)', async () => {
    // No Pine buffer in the default electron workspace — expect the no-Pine path.
    const result = await vscode.commands.executeCommand('axis.openChart');
    assert.strictEqual(result, OPEN_CHART_NO_PINE_MESSAGE);
  });

  test('axis.runScript without active Pine returns clear error (no await UI)', async () => {
    const result = await vscode.commands.executeCommand('axis.runScript');
    assert.strictEqual(result, RUN_NO_PINE_MESSAGE);
  });

  test('default axis.chart.useMockBars is false (HistoryClient dogfood)', () => {
    const config = vscode.workspace.getConfiguration('axis.chart');
    assert.strictEqual(config.get('useMockBars'), false);
  });

  test('default axis.datafeed.url is loopback :5003', () => {
    const config = vscode.workspace.getConfiguration('axis.datafeed');
    assert.strictEqual(config.get('url'), 'http://127.0.0.1:5003');
  });

  test('default axis.engine.id / endpoint / allowRemoteEndpoint', () => {
    const config = vscode.workspace.getConfiguration('axis.engine');
    assert.strictEqual(config.get('id'), 'server');
    assert.strictEqual(config.get('endpoint'), 'http://127.0.0.1:5002');
    assert.strictEqual(config.get('allowRemoteEndpoint'), false);
  });

  test('axis.engine.allowRemoteEndpoint is application-scoped (not workspace)', () => {
    const configuration = Array.isArray(pkg.contributes?.configuration)
      ? pkg.contributes.configuration
      : pkg.contributes?.configuration
        ? [pkg.contributes.configuration]
        : [];
    const props = configuration.flatMap((group) =>
      Object.entries(group.properties ?? {}),
    );
    const entry = props.find(([key]) => key === 'axis.engine.allowRemoteEndpoint');
    assert.ok(entry, 'missing axis.engine.allowRemoteEndpoint');
    const meta = entry?.[1] as { scope?: string; default?: boolean };
    assert.strictEqual(meta.scope, 'application');
    assert.strictEqual(meta.default, false);
  });

  test('axis.mcp.command / allowNpx are application-scoped (not workspace)', () => {
    const configuration = Array.isArray(pkg.contributes?.configuration)
      ? pkg.contributes.configuration
      : pkg.contributes?.configuration
        ? [pkg.contributes.configuration]
        : [];
    const props = configuration.flatMap((group) =>
      Object.entries(group.properties ?? {}),
    );
    for (const key of ['axis.mcp.command', 'axis.mcp.allowNpx'] as const) {
      const entry = props.find(([k]) => k === key);
      assert.ok(entry, `missing ${key}`);
      const meta = entry?.[1] as { scope?: string };
      assert.strictEqual(meta.scope, 'application', `${key} must be application-scoped`);
    }
  });

  test('axis.mcp.command / allowNpx are application-scoped (not workspace)', () => {
    const configuration = Array.isArray(pkg.contributes?.configuration)
      ? pkg.contributes.configuration
      : pkg.contributes?.configuration
        ? [pkg.contributes.configuration]
        : [];
    const props = configuration.flatMap((group) =>
      Object.entries(group.properties ?? {}),
    );
    for (const key of ['axis.mcp.command', 'axis.mcp.allowNpx'] as const) {
      const entry = props.find(([k]) => k === key);
      assert.ok(entry, `missing ${key}`);
      const meta = entry?.[1] as { scope?: string };
      assert.strictEqual(meta.scope, 'application', `${key} must be application-scoped`);
    }
  });

  test('default axis.telemetry.offline is true', () => {
    const config = vscode.workspace.getConfiguration('axis');
    assert.strictEqual(config.get('telemetry.offline'), true);
  });

  test('warns (does not fail) if installed PYNE is older than recommended', () => {
    const pyne = vscode.extensions.getExtension(PYNE_EXT_ID);
    if (!pyne) {
      console.warn(
        `[axis-ide test] ${PYNE_EXT_ID} not present in this run; skip version warn check.`,
      );
      return;
    }
    const ver = String(pyne.packageJSON?.version ?? '');
    if (ver && isVersionOlderThan(ver, PYNE_RECOMMENDED_MIN)) {
      console.warn(
        `[axis-ide test] ${PYNE_EXT_ID} ${ver} < recommended ${PYNE_RECOMMENDED_MIN} (warn only).`,
      );
    }
    // Never hard-fail on PYNE semver — extensionDependencies is id-only.
    assert.ok(true);
  });
});

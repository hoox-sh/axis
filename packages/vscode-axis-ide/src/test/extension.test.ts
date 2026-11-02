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
import {
  OPEN_CHART_UNAVAILABLE_MESSAGE,
  RUN_OUTPUT_CHANNEL_NAME,
} from '../constants';
import { CHART_VIEW_TYPE } from '../editors/chart-document';
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
    configuration?:
      | Array<{ properties: Record<string, unknown> }>
      | { properties: Record<string, unknown> };
  };
};

/** Exact contribute inventory — expand only when package.json contributes grow (KD-14). */
const EXPECTED_COMMANDS = [
  'axis.showRunOutput',
  'axis.openChart',
  'axis.secrets.setWorkerKey',
  'axis.secrets.setProKey',
  'axis.secrets.clear',
] as const;
const EXPECTED_SETTINGS = ['axis.telemetry.offline'] as const;
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
const ALLOWED_CONTRIBUTE_KEYS = new Set(['commands', 'configuration', 'customEditors']);
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
    assert.ok(
      !('views' in (pkg.contributes ?? {})),
      'views must not land before their PR (no premature watchlist/results)',
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

  test('contributes keys are only commands + configuration + customEditors', () => {
    const keys = Object.keys(pkg.contributes ?? {});
    for (const key of keys) {
      assert.ok(
        ALLOWED_CONTRIBUTE_KEYS.has(key),
        `unexpected contributes.${key} — allowed: commands/configuration/customEditors`,
      );
    }
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

  test('axis.openChart stub returns product message without awaiting UI', async () => {
    const result = await vscode.commands.executeCommand('axis.openChart');
    assert.strictEqual(result, OPEN_CHART_UNAVAILABLE_MESSAGE);
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

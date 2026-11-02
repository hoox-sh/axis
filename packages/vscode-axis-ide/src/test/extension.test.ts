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
    configuration?:
      | Array<{ properties: Record<string, unknown> }>
      | { properties: Record<string, unknown> };
  };
};

/** Exact P0 inventory — expand only when package.json contributes grow. */
const EXPECTED_COMMANDS = ['axis.showRunOutput', 'axis.openChart'] as const;
const EXPECTED_SETTINGS = ['axis.telemetry.offline'] as const;
const EXPECTED_WORKSPACE_CONTAINS = [
  'workspaceContains:**/*.axis.json',
  'workspaceContains:**/*.pyne',
  'workspaceContains:**/*.pine',
  'workspaceContains:**/*.pinev5',
  'workspaceContains:**/*.pinev6',
  'workspaceContains:**/*.pinescript',
] as const;
const ALLOWED_CONTRIBUTE_KEYS = new Set(['commands', 'configuration']);

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

  test('activationEvents: no onStartupFinished; onCommand + workspaceContains', () => {
    const events = pkg.activationEvents ?? [];
    assert.ok(!events.includes('onStartupFinished'), 'must not use onStartupFinished');
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

  test('contributes only P0 commands', () => {
    const commandIds = (pkg.contributes?.commands ?? []).map((c) => c.command);
    for (const id of EXPECTED_COMMANDS) {
      assert.ok(commandIds.includes(id), `Missing command: ${id}`);
    }
    assert.deepStrictEqual(
      [...commandIds].sort(),
      [...EXPECTED_COMMANDS].sort(),
      'P0 command inventory drifted — update test when intentionally expanding contributes',
    );
  });

  test('contributes only P0 settings (optional telemetry)', () => {
    const configuration = Array.isArray(pkg.contributes?.configuration)
      ? pkg.contributes.configuration
      : pkg.contributes?.configuration
        ? [pkg.contributes.configuration]
        : [];
    const settings = configuration.flatMap((group) => Object.keys(group.properties ?? {}));
    for (const key of EXPECTED_SETTINGS) {
      assert.ok(settings.includes(key), `Missing setting: ${key}`);
    }
    assert.deepStrictEqual(
      [...settings].sort(),
      [...EXPECTED_SETTINGS].sort(),
      'P0 setting inventory drifted',
    );
  });

  test('contributes keys are only commands + configuration', () => {
    const keys = Object.keys(pkg.contributes ?? {});
    for (const key of keys) {
      assert.ok(
        ALLOWED_CONTRIBUTE_KEYS.has(key),
        `unexpected contributes.${key} — P0 allows only commands/configuration`,
      );
    }
  });
});

suite('AXIS IDE Extension Activation', () => {
  test('activates and registers P0 commands', async () => {
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

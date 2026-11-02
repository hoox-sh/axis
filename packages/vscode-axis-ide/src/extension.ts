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

/**
 * AXIS IDE — VS Code extension host entry (scaffold).
 *
 * Unofficial independent project. Not affiliated with or endorsed by TradingView, Inc.
 * Pine Script™ and TradingView® are trademarks of TradingView, Inc.
 */

import {
  type ExtensionContext,
  type OutputChannel,
  StatusBarAlignment,
  type StatusBarItem,
  commands,
  extensions,
  window,
} from 'vscode';
import {
  OPEN_CHART_UNAVAILABLE_MESSAGE,
  RUN_OUTPUT_CHANNEL_NAME,
} from './constants';
import {
  AxisSecretStorage,
  SECRET_STORE_ERROR,
  formatSecretStatus,
  validateProKey,
  validateWorkerKey,
} from './secrets';
import { isVersionOlderThan } from './semver';

/** Keep in sync with package.json contributes.commands (grow with KD-14). */
export const COMMANDS = {
  showRunOutput: 'axis.showRunOutput',
  openChart: 'axis.openChart',
  setWorkerKey: 'axis.secrets.setWorkerKey',
  setProKey: 'axis.secrets.setProKey',
  clearSecrets: 'axis.secrets.clear',
} as const;

const PYNE_EXT_ID = 'hoox-sh.pyne';
const PYNE_RECOMMENDED_MIN = '0.5.4';

let runOutput: OutputChannel | undefined;
let statusBar: StatusBarItem | undefined;
let secrets: AxisSecretStorage | undefined;
/** Set in deactivate so any late work skips after shutdown. */
let deactivated = false;

function warnIfPyneBelowRecommended(): void {
  if (deactivated) return;
  const pyne = extensions.getExtension(PYNE_EXT_ID);
  if (!pyne) {
    console.warn(
      `[axis-ide] Recommended dependency ${PYNE_EXT_ID} is not installed.`,
    );
    return;
  }
  const ver = String(pyne.packageJSON?.version ?? '');
  if (ver && isVersionOlderThan(ver, PYNE_RECOMMENDED_MIN)) {
    console.warn(
      `[axis-ide] ${PYNE_EXT_ID} ${ver} is older than recommended ≥${PYNE_RECOMMENDED_MIN}.`,
    );
  }
}

/** StatusBar text + tooltip show set/missing only — never key material. */
async function refreshSecretStatus(): Promise<void> {
  if (deactivated || !statusBar || !secrets) return;
  try {
    const worker = (await secrets.hasWorkerKey()) ? 'set' : 'missing';
    const pro = (await secrets.hasProKey()) ? 'set' : 'missing';
    if (deactivated || !statusBar) return;
    const label = formatSecretStatus(worker, pro);
    statusBar.text = label.text;
    statusBar.tooltip = label.tooltip;
  } catch {
    if (deactivated || !statusBar) return;
    statusBar.text = '$(graph) AXIS';
    statusBar.tooltip = 'AXIS IDE\nWorker key: unknown\nPro key: unknown';
  }
}

async function promptAndSetWorkerKey(): Promise<string | undefined> {
  if (deactivated || !secrets) return undefined;
  const raw = await window.showInputBox({
    title: 'AXIS Worker API Key',
    prompt: 'Paste a Worker key (pn_ + 48 hex). Empty clears. SecretStorage only.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'pn_…',
    validateInput: (value) => {
      const t = value.trim();
      if (!t) return null; // empty → clear on accept
      const r = validateWorkerKey(t);
      return r.ok ? null : r.error;
    },
  });
  if (deactivated || raw === undefined || !secrets) return undefined;
  try {
    const result = await secrets.setWorkerKey(raw);
    if (!result.ok) {
      void window.showErrorMessage(result.error);
      return result.error;
    }
    await refreshSecretStatus();
    const cleared = raw.trim().length === 0;
    void window.showInformationMessage(
      cleared
        ? 'AXIS Worker key cleared (SecretStorage).'
        : 'AXIS Worker key saved (SecretStorage).',
    );
    return cleared ? 'cleared' : 'ok';
  } catch {
    void window.showErrorMessage(SECRET_STORE_ERROR);
    return SECRET_STORE_ERROR;
  }
}

async function promptAndSetProKey(): Promise<string | undefined> {
  if (deactivated || !secrets) return undefined;
  const raw = await window.showInputBox({
    title: 'AXIS Pro API Key',
    prompt: 'Paste a PYNE Pro key (pyn_…). Empty clears. SecretStorage only.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'pyn_…',
    validateInput: (value) => {
      const t = value.trim();
      if (!t) return null;
      const r = validateProKey(t);
      return r.ok ? null : r.error;
    },
  });
  if (deactivated || raw === undefined || !secrets) return undefined;
  try {
    const result = await secrets.setProKey(raw);
    if (!result.ok) {
      void window.showErrorMessage(result.error);
      return result.error;
    }
    await refreshSecretStatus();
    const cleared = raw.trim().length === 0;
    void window.showInformationMessage(
      cleared
        ? 'AXIS Pro key cleared (SecretStorage).'
        : 'AXIS Pro key saved (SecretStorage).',
    );
    return cleared ? 'cleared' : 'ok';
  } catch {
    void window.showErrorMessage(SECRET_STORE_ERROR);
    return SECRET_STORE_ERROR;
  }
}

async function promptAndClearSecrets(): Promise<string | undefined> {
  if (deactivated || !secrets) return undefined;
  const confirm = await window.showWarningMessage(
    'Clear stored AXIS Worker and Pro API keys from SecretStorage?',
    { modal: true },
    'Clear',
  );
  if (deactivated || confirm !== 'Clear' || !secrets) return undefined;
  try {
    // Matches confirm copy — Worker + Pro only (not pyne-worker / git PAT).
    await secrets.clearWorkerAndProKeys();
    await refreshSecretStatus();
    void window.showInformationMessage('AXIS Worker and Pro secrets cleared.');
    return 'cleared';
  } catch {
    void window.showErrorMessage(SECRET_STORE_ERROR);
    return SECRET_STORE_ERROR;
  }
}

export function activate(context: ExtensionContext): void {
  deactivated = false;

  secrets = new AxisSecretStorage(context.secrets);

  runOutput = window.createOutputChannel(RUN_OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(runOutput);

  statusBar = window.createStatusBarItem('axis.ide.status', StatusBarAlignment.Left, 100);
  statusBar.name = 'AXIS IDE';
  statusBar.text = '$(graph) AXIS';
  statusBar.tooltip = 'AXIS IDE';
  statusBar.command = COMMANDS.showRunOutput;
  context.subscriptions.push(statusBar);
  statusBar.show();

  context.subscriptions.push(
    commands.registerCommand(COMMANDS.showRunOutput, () => {
      if (deactivated) return;
      runOutput?.show(true);
      return RUN_OUTPUT_CHANNEL_NAME;
    }),
    commands.registerCommand(COMMANDS.openChart, () => {
      if (deactivated) return;
      // Do not await — showInformationMessage waits for dismissal and stalls tests/CI.
      void window.showInformationMessage(OPEN_CHART_UNAVAILABLE_MESSAGE);
      return OPEN_CHART_UNAVAILABLE_MESSAGE;
    }),
    commands.registerCommand(COMMANDS.setWorkerKey, () => promptAndSetWorkerKey()),
    commands.registerCommand(COMMANDS.setProKey, () => promptAndSetProKey()),
    commands.registerCommand(COMMANDS.clearSecrets, () => promptAndClearSecrets()),
  );

  // Sync check — avoid deferred timers that can outlive deactivate.
  warnIfPyneBelowRecommended();
  const ver = String(context.extension.packageJSON?.version ?? '');
  runOutput.appendLine(ver ? `AXIS IDE activated (${ver}).` : 'AXIS IDE activated.');

  // Fire-and-forget status refresh; guard inside refreshSecretStatus.
  void refreshSecretStatus();
}

export function deactivate(): void {
  deactivated = true;
  runOutput = undefined;
  statusBar = undefined;
  secrets = undefined;
}

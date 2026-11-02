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
import { isVersionOlderThan } from './semver';

/** Keep in sync with package.json contributes.commands (P0 subset). */
export const COMMANDS = {
  showRunOutput: 'axis.showRunOutput',
  openChart: 'axis.openChart',
} as const;

const PYNE_EXT_ID = 'hoox-sh.pyne';
const PYNE_RECOMMENDED_MIN = '0.5.4';

let runOutput: OutputChannel | undefined;
let statusBar: StatusBarItem | undefined;
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

export function activate(context: ExtensionContext): void {
  deactivated = false;

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
  );

  // Sync check — avoid deferred timers that can outlive deactivate.
  warnIfPyneBelowRecommended();
  const ver = String(context.extension.packageJSON?.version ?? '');
  runOutput.appendLine(ver ? `AXIS IDE activated (${ver}).` : 'AXIS IDE activated.');
}

export function deactivate(): void {
  deactivated = true;
  runOutput = undefined;
  statusBar = undefined;
}

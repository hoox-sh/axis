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
 * Live command ids + vscode-free registration helpers for the wiring agent.
 * package.json merge is deferred — see `live-contributes.fragment.json`.
 */

import type { LiveSessionBridge, LiveStartResult } from './bridge';

/** Keep in sync with live-contributes.fragment.json (package.json merge later). */
export const LIVE_COMMANDS = {
  liveStart: 'axis.liveStart',
  liveStop: 'axis.liveStop',
} as const;

export type LiveCommandId = (typeof LIVE_COMMANDS)[keyof typeof LIVE_COMMANDS];

export type LiveCommandDisposable = { dispose(): void };

/** Minimal command registrar (vscode.commands.registerCommand-compatible). */
export type LiveCommandRegistrar = {
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown,
  ): LiveCommandDisposable;
};

export type LiveCommandHandlers = {
  start(): Promise<LiveStartResult>;
  stop(): void;
};

/** Bind start/stop to a bridge (or test doubles). */
export function liveCommandHandlers(bridge: LiveSessionBridge): LiveCommandHandlers {
  return {
    start: () => bridge.start(),
    stop: () => {
      bridge.stop();
    },
  };
}

/**
 * Register `axis.liveStart` / `axis.liveStop`. Returns disposables for
 * `context.subscriptions` (wiring agent merges into extension.ts later).
 */
export function registerLiveCommands(
  commands: LiveCommandRegistrar,
  bridge: LiveSessionBridge,
): LiveCommandDisposable[] {
  const handlers = liveCommandHandlers(bridge);
  return [
    commands.registerCommand(LIVE_COMMANDS.liveStart, () => handlers.start()),
    commands.registerCommand(LIVE_COMMANDS.liveStop, () => handlers.stop()),
  ];
}

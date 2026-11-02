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

/** Injectable sink so protocol tests stay free of the VS Code API. */
export type LogSink = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;

const defaultSink: LogSink = (level, message) => {
  const line = `[axis] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

let sink: LogSink = defaultSink;
let debugProtocol = false;

/** Swap the sink (tests / OutputChannel bridge). */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

/** Gate for `axis.debug.protocol` (setting wired later). */
export function setDebugProtocol(enabled: boolean): void {
  debugProtocol = enabled;
}

export function isDebugProtocol(): boolean {
  return debugProtocol;
}

/** Restore defaults between tests. */
export function resetLoggerForTests(): void {
  sink = defaultSink;
  debugProtocol = false;
}

export function logDebug(message: string): void {
  if (!debugProtocol) return;
  sink('debug', message);
}

export function logInfo(message: string): void {
  sink('info', message);
}

export function logWarn(message: string): void {
  sink('warn', message);
}

export function logError(message: string): void {
  sink('error', message);
}

/** Log a protocol reject without echoing secret-bearing payloads. */
export function logProtocolReject(error: { code: string; message: string }, type?: string): void {
  const tip = type ? ` type=${type}` : '';
  const line = `protocol reject code=${error.code}${tip} ${error.message}`;
  if (debugProtocol) sink('debug', line);
  else sink('warn', line);
}

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

export {
  LiveSessionBridge,
  createLiveSessionBridge,
  prepareLiveConnectUrl,
  type LiveFrameHandler,
  type LiveOutput,
  type LiveSecrets,
  type LiveSessionBridgeDeps,
  type LiveStartResult,
  type LiveStatusListener,
  type LiveWebSocket,
  type LiveWebSocketConstructor,
} from './bridge';
export {
  createLiveChartFanout,
  type LiveChartFanout,
  type LiveChartFanoutDeps,
  type LiveChartNotify,
} from './chart-fanout';
export {
  LIVE_COMMANDS,
  liveCommandHandlers,
  registerLiveCommands,
  type LiveCommandDisposable,
  type LiveCommandHandlers,
  type LiveCommandId,
  type LiveCommandRegistrar,
} from './commands';
export {
  normalizeLiveFrame,
  seriesKeyFromFrameId,
  toChartDeltaPayload,
  toChartFullPayload,
  type NormalizedWireFrame,
  type WireFrameKind,
} from './frames';
export {
  createLiveResumeStub,
  type LiveResumeReason,
  type LiveResumeResult,
  type LiveResumeStub,
  type LiveResumeStubDeps,
} from './resume';
export {
  formatLiveStatus,
  resolveLiveHud,
  type LiveHudInput,
  type LiveHudState,
  type LiveStatusLabel,
  type LiveWireStatus,
} from './status';
export {
  DEFAULT_WORKER_URL,
  LIVE_TICKET_TTL_S,
  LIVE_WS_PATH,
  MCP_BRIDGE_PATH,
  LiveTicketError,
  assertSafeLiveWsUrl,
  checkWorkerUrl,
  isLiveTicketError,
  liveTicketRetryable,
  looksLikeWorkerEndpoint,
  mintLiveTicket,
  shouldUseLiveProxy,
  workerLiveHttpUrl,
  workerLiveWsUrl,
  type LiveProxy,
  type MintLiveTicketOpts,
} from './ticket';

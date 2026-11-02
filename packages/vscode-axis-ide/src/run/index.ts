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
  getLastChartFull,
  notifyChart,
  resetChartBusForTests,
  subscribeChartNotify,
  type ChartFullNotify,
  type ChartNotifyHandler,
  type ChartNotifyMessage,
} from './chart-bus';
export {
  BAD_ENDPOINT_SCHEME,
  REMOTE_ENDPOINT_DENIED,
  checkEngineEndpoint,
  checkHttpBaseUrl,
  type EndpointCheck,
  type HttpBaseUrlOptions,
} from './endpoint';
export {
  DEFAULT_ENGINE_ENDPOINT,
  MISSING_API_KEY_ERROR,
  MISSING_ENDPOINT_ERROR,
  barsForPine,
  mapEngineResponse,
  postEngineRun,
  type EngineCompileDiagnostic,
  type EngineHttpRequest,
  type EngineRunResult,
  type FetchLike,
  type RunMode,
} from './engine-http';
export {
  MISSING_PRO_KEY_ERROR,
  UNSUPPORTED_ENGINE_ERROR,
  RunOrchestrator,
  type RunDeps,
  type RunDiagnostic,
  type RunDiagnostics,
  type RunOutcome,
  type RunOutput,
  type RunRequest,
  type RunSecrets,
} from './orchestrator';
export {
  ResultsFocusStore,
  copyRunRecord,
  pickStrategyReport,
  type PublishInput,
  type ResultsFocusChangeReason,
  type ResultsFocusListener,
  type ResultsFocusSnapshot,
  type RunResultRecord,
} from './results-store';
export {
  resolveRunContext,
  type ResolvedRunContext,
  type ResolveRunContextResult,
  type RunContextSettings,
} from './run-context';
export { scrubSecrets } from './scrub';

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

/** Schema version for every axis.webview.v1 envelope. */
export const PROTOCOL_VERSION = 1 as const;

/** Loggable decode/encode error codes (single source for tests + codec). */
export const PROTOCOL_ERROR_CODES = {
  BAD_ENVELOPE: 'BAD_ENVELOPE',
  BAD_VERSION: 'BAD_VERSION',
  BAD_TYPE: 'BAD_TYPE',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  BAD_TS: 'BAD_TS',
  BAD_ID: 'BAD_ID',
  BAD_PAYLOAD: 'BAD_PAYLOAD',
} as const;

export type ProtocolErrorCode =
  (typeof PROTOCOL_ERROR_CODES)[keyof typeof PROTOCOL_ERROR_CODES];

/** Wire envelope shared by host ↔ webview. */
export interface AxisEnvelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  type: MessageType;
  payload: T;
  ts: number;
  id?: string;
}

/** Host → view message types. */
export const HOST_TO_VIEW = {
  ChartInit: 'chart.init',
  ChartFull: 'chart.full',
  ChartDelta: 'chart.delta',
  ChartTheme: 'chart.theme',
  ChartDrawingApply: 'chart.drawing.apply',
  HostRunStatus: 'host.run.status',
  HostError: 'host.error',
  ResultsSet: 'results.set',
} as const;

/** View → host message types. */
export const VIEW_TO_HOST = {
  WebviewReady: 'webview.ready',
  ChartViewport: 'chart.viewport',
  DrawingSetTool: 'drawing.setTool',
  DrawingCommit: 'drawing.commit',
  ChartRequestReload: 'chart.requestReload',
  ResultsFocus: 'results.focus',
  ResultsReady: 'results.ready',
} as const;

export type HostToViewType = (typeof HOST_TO_VIEW)[keyof typeof HOST_TO_VIEW];
export type ViewToHostType = (typeof VIEW_TO_HOST)[keyof typeof VIEW_TO_HOST];
export type MessageType = HostToViewType | ViewToHostType;

/** Design §6 handshake views. */
export const WEBVIEW_VIEWS = ['chart', 'results'] as const;
export type WebviewView = (typeof WEBVIEW_VIEWS)[number];
export const WEBVIEW_VIEW_SET: ReadonlySet<string> = new Set(WEBVIEW_VIEWS);

/** All known types (single source — tests import this, do not re-list strings). */
export const ALL_MESSAGE_TYPES: readonly MessageType[] = [
  ...Object.values(HOST_TO_VIEW),
  ...Object.values(VIEW_TO_HOST),
];

/** Frozen golden list matching design §6 (tests assert equality with ALL_MESSAGE_TYPES). */
export const SECTION_6_MESSAGE_TYPES: readonly MessageType[] = [
  HOST_TO_VIEW.ChartInit,
  HOST_TO_VIEW.ChartFull,
  HOST_TO_VIEW.ChartDelta,
  HOST_TO_VIEW.ChartTheme,
  HOST_TO_VIEW.ChartDrawingApply,
  HOST_TO_VIEW.HostRunStatus,
  HOST_TO_VIEW.HostError,
  VIEW_TO_HOST.WebviewReady,
  VIEW_TO_HOST.ChartViewport,
  VIEW_TO_HOST.DrawingSetTool,
  VIEW_TO_HOST.DrawingCommit,
  VIEW_TO_HOST.ChartRequestReload,
  HOST_TO_VIEW.ResultsSet,
  VIEW_TO_HOST.ResultsFocus,
  VIEW_TO_HOST.ResultsReady,
];

export const HOST_TO_VIEW_TYPES: ReadonlySet<string> = new Set(Object.values(HOST_TO_VIEW));
export const VIEW_TO_HOST_TYPES: ReadonlySet<string> = new Set(Object.values(VIEW_TO_HOST));
export const KNOWN_TYPES: ReadonlySet<string> = new Set(ALL_MESSAGE_TYPES);

/** Active plugin ids on the chart HUD (source/stream/engine/storage). Additive. */
export interface ChartPluginsPayload {
  source?: string;
  stream?: string;
  engine?: string;
  storage?: string;
}

export interface ChartInitPayload {
  theme: unknown;
  cssVars: unknown;
  seriesKey: string;
  panes: unknown;
  /** User drawings from `*.axis.json` (MVP trendlines); optional on the wire. */
  drawings?: unknown;
  /** Active plugins; omitted is backward compatible. */
  plugins?: ChartPluginsPayload;
}

export interface ChartFullPayload {
  bars: unknown;
  plots?: unknown;
  drawings?: unknown;
  seq: number;
}

export interface ChartDeltaPayload {
  baseIndex: number;
  tail: unknown;
  plots?: unknown;
  seq: number;
}

export interface ChartThemePayload {
  kind: string;
  cssVars: unknown;
}

/** Script drawings batch — plain object or array on the wire. */
export type ChartDrawingApplyPayload = Record<string, unknown> | readonly unknown[];

export interface HostRunStatusPayload {
  epoch: number;
  state: string;
  message?: string;
  /** Live HUD plugin chips; extra fields besides this stay allowed. */
  plugins?: ChartPluginsPayload;
}

export interface HostErrorPayload {
  code: string;
  message: string;
}

export interface WebviewReadyPayload {
  view: WebviewView;
  /** Omitted on encode/decode input → normalized to `[]`. */
  capabilities?: string[];
}

export interface ChartViewportPayload {
  from: number;
  to: number;
  logical?: unknown;
}

export interface DrawingSetToolPayload {
  tool: string;
}

/** User drawing commit — plain object only (arrays rejected at encode/decode). */
export type DrawingCommitPayload = Record<string, unknown>;

export type ChartRequestReloadPayload = Record<string, never>;

export interface ResultsSetPayload {
  lastRun: unknown;
  strategyReport: unknown;
  focusId: unknown;
}

export interface ResultsFocusPayload {
  runId: string;
}

export type ResultsReadyPayload = Record<string, never>;

/** Payload map keyed by message-type constants (no duplicated wire strings). */
export type PayloadByType = {
  [HOST_TO_VIEW.ChartInit]: ChartInitPayload;
  [HOST_TO_VIEW.ChartFull]: ChartFullPayload;
  [HOST_TO_VIEW.ChartDelta]: ChartDeltaPayload;
  [HOST_TO_VIEW.ChartTheme]: ChartThemePayload;
  [HOST_TO_VIEW.ChartDrawingApply]: ChartDrawingApplyPayload;
  [HOST_TO_VIEW.HostRunStatus]: HostRunStatusPayload;
  [HOST_TO_VIEW.HostError]: HostErrorPayload;
  [HOST_TO_VIEW.ResultsSet]: ResultsSetPayload;
  [VIEW_TO_HOST.WebviewReady]: WebviewReadyPayload;
  [VIEW_TO_HOST.ChartViewport]: ChartViewportPayload;
  [VIEW_TO_HOST.DrawingSetTool]: DrawingSetToolPayload;
  [VIEW_TO_HOST.DrawingCommit]: DrawingCommitPayload;
  [VIEW_TO_HOST.ChartRequestReload]: ChartRequestReloadPayload;
  [VIEW_TO_HOST.ResultsFocus]: ResultsFocusPayload;
  [VIEW_TO_HOST.ResultsReady]: ResultsReadyPayload;
};

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
}

export type DecodeOk = { ok: true; envelope: AxisEnvelope };
export type DecodeErr = { ok: false; error: ProtocolError };
export type DecodeResult = DecodeOk | DecodeErr;

export interface EncodeOptions {
  id?: string;
  ts?: number;
}

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

import {
  HOST_TO_VIEW,
  HOST_TO_VIEW_TYPES,
  KNOWN_TYPES,
  PROTOCOL_ERROR_CODES,
  PROTOCOL_VERSION,
  VIEW_TO_HOST,
  VIEW_TO_HOST_TYPES,
  WEBVIEW_VIEW_SET,
  type AxisEnvelope,
  type DecodeResult,
  type EncodeOptions,
  type HostToViewType,
  type MessageType,
  type PayloadByType,
  type ProtocolError,
  type ProtocolErrorCode,
  type ViewToHostType,
  type WebviewView,
} from './types';

function err(code: ProtocolErrorCode, message: string): ProtocolError {
  return { code, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const CHART_PLUGIN_KEYS = ['source', 'stream', 'engine', 'storage'] as const;

/**
 * Optional `plugins` object: plain object required when present; unknown keys
 * ignored; missing is OK. Arrays / non-objects rejected.
 */
function normalizeChartPlugins(
  raw: unknown,
  label: string,
): { error: ProtocolError } | { error: null; plugins: Record<string, string> } {
  if (!isPlainObject(raw)) {
    return {
      error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, `${label} must be an object`),
    };
  }
  const plugins: Record<string, string> = {};
  for (const key of CHART_PLUGIN_KEYS) {
    const v = raw[key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed) plugins[key] = trimmed;
  }
  return { error: null, plugins };
}

function requireEmptyObject(type: MessageType, payload: unknown): ProtocolError | null {
  if (!isPlainObject(payload)) {
    return err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, `${type} payload must be an object`);
  }
  if (Object.keys(payload).length !== 0) {
    return err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, `${type} payload must be an empty object`);
  }
  return null;
}

/**
 * Validate + normalize payload. Returns error or the (possibly normalized) payload.
 * Normalization: webview.ready defaults capabilities to [].
 */
function validatePayload(
  type: MessageType,
  payload: unknown,
): { error: ProtocolError } | { error: null; payload: unknown } {
  switch (type) {
    case HOST_TO_VIEW.ChartInit: {
      if (!isPlainObject(payload)) {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.init payload must be an object') };
      }
      if (typeof payload.seriesKey !== 'string') {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.init.seriesKey must be a string') };
      }
      if (!('theme' in payload) || !('cssVars' in payload) || !('panes' in payload)) {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'chart.init requires theme, cssVars, seriesKey, panes',
          ),
        };
      }
      if (payload.plugins !== undefined) {
        const plugins = normalizeChartPlugins(payload.plugins, 'chart.init.plugins');
        if (plugins.error) return { error: plugins.error };
        return { error: null, payload: { ...payload, plugins: plugins.plugins } };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.ChartFull: {
      if (!isPlainObject(payload)) {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.full payload must be an object') };
      }
      if (!('bars' in payload) || !isFiniteNumber(payload.seq)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.full requires bars and numeric seq'),
        };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.ChartDelta: {
      if (!isPlainObject(payload)) {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.delta payload must be an object') };
      }
      if (!isFiniteNumber(payload.baseIndex) || !('tail' in payload) || !isFiniteNumber(payload.seq)) {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'chart.delta requires baseIndex, tail, and numeric seq',
          ),
        };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.ChartTheme: {
      if (!isPlainObject(payload)) {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.theme payload must be an object') };
      }
      if (typeof payload.kind !== 'string' || payload.kind.length === 0 || !('cssVars' in payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.theme requires kind string and cssVars'),
        };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.ChartDrawingApply: {
      if (payload === null || typeof payload !== 'object') {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'chart.drawing.apply payload must be an object or array',
          ),
        };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.HostRunStatus: {
      if (!isPlainObject(payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'host.run.status payload must be an object'),
        };
      }
      if (!isFiniteNumber(payload.epoch) || typeof payload.state !== 'string') {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'host.run.status requires numeric epoch and state string',
          ),
        };
      }
      if (payload.message !== undefined && typeof payload.message !== 'string') {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'host.run.status.message must be a string when present',
          ),
        };
      }
      if (payload.plugins !== undefined) {
        const plugins = normalizeChartPlugins(payload.plugins, 'host.run.status.plugins');
        if (plugins.error) return { error: plugins.error };
        return { error: null, payload: { ...payload, plugins: plugins.plugins } };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.HostError: {
      if (!isPlainObject(payload)) {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'host.error payload must be an object') };
      }
      if (typeof payload.code !== 'string' || typeof payload.message !== 'string') {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'host.error requires code and message strings'),
        };
      }
      return { error: null, payload };
    }
    case HOST_TO_VIEW.ResultsSet: {
      if (!isPlainObject(payload)) {
        return { error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'results.set payload must be an object') };
      }
      if (!('lastRun' in payload) || !('strategyReport' in payload) || !('focusId' in payload)) {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'results.set requires lastRun, strategyReport, focusId',
          ),
        };
      }
      return { error: null, payload };
    }
    case VIEW_TO_HOST.WebviewReady: {
      if (!isPlainObject(payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'webview.ready payload must be an object'),
        };
      }
      if (typeof payload.view !== 'string' || !WEBVIEW_VIEW_SET.has(payload.view)) {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'webview.ready.view must be "chart" or "results"',
          ),
        };
      }
      let capabilities: string[];
      if (payload.capabilities === undefined) {
        capabilities = [];
      } else if (
        !Array.isArray(payload.capabilities) ||
        !payload.capabilities.every((c) => typeof c === 'string')
      ) {
        return {
          error: err(
            PROTOCOL_ERROR_CODES.BAD_PAYLOAD,
            'webview.ready.capabilities must be string[] when present',
          ),
        };
      } else {
        capabilities = payload.capabilities as string[];
      }
      return {
        error: null,
        payload: { view: payload.view as WebviewView, capabilities },
      };
    }
    case VIEW_TO_HOST.ChartViewport: {
      if (!isPlainObject(payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.viewport payload must be an object'),
        };
      }
      if (!isFiniteNumber(payload.from) || !isFiniteNumber(payload.to)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'chart.viewport requires numeric from and to'),
        };
      }
      return { error: null, payload };
    }
    case VIEW_TO_HOST.DrawingSetTool: {
      if (!isPlainObject(payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'drawing.setTool payload must be an object'),
        };
      }
      if (typeof payload.tool !== 'string') {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'drawing.setTool.tool must be a string'),
        };
      }
      return { error: null, payload };
    }
    case VIEW_TO_HOST.DrawingCommit: {
      if (!isPlainObject(payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'drawing.commit payload must be an object'),
        };
      }
      return { error: null, payload };
    }
    case VIEW_TO_HOST.ChartRequestReload: {
      const empty = requireEmptyObject(type, payload);
      if (empty) return { error: empty };
      return { error: null, payload };
    }
    case VIEW_TO_HOST.ResultsFocus: {
      if (!isPlainObject(payload)) {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'results.focus payload must be an object'),
        };
      }
      if (typeof payload.runId !== 'string') {
        return {
          error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'results.focus.runId must be a string'),
        };
      }
      return { error: null, payload };
    }
    case VIEW_TO_HOST.ResultsReady: {
      const empty = requireEmptyObject(type, payload);
      if (empty) return { error: empty };
      return { error: null, payload };
    }
    default: {
      const _exhaustive: never = type;
      return {
        error: err(
          PROTOCOL_ERROR_CODES.BAD_TYPE,
          `unhandled message type: ${String(_exhaustive)}`,
        ),
      };
    }
  }
}

/**
 * Build a versioned envelope. Throws on unknown type or invalid payload
 * (trusted call sites). Use {@link decode} for untrusted wire input.
 */
export function encode<T extends MessageType>(
  type: T,
  payload: PayloadByType[T],
  opts?: EncodeOptions,
): AxisEnvelope<PayloadByType[T]> {
  if (!KNOWN_TYPES.has(type)) {
    throw new Error(`encode: unknown message type: ${String(type)}`);
  }
  if (opts?.ts !== undefined && !isFiniteNumber(opts.ts)) {
    throw new Error('encode: opts.ts must be a finite number');
  }
  if (opts?.id !== undefined && (typeof opts.id !== 'string' || opts.id.length === 0)) {
    throw new Error('encode: opts.id must be a non-empty string when present');
  }
  const checked = validatePayload(type, payload);
  if (checked.error) {
    throw new Error(`encode: ${checked.error.message}`);
  }
  const envelope: AxisEnvelope<PayloadByType[T]> = {
    v: PROTOCOL_VERSION,
    type,
    payload: checked.payload as PayloadByType[T],
    ts: opts?.ts ?? Date.now(),
  };
  if (opts?.id !== undefined) {
    envelope.id = opts.id;
  }
  return envelope;
}

function decodeInner(raw: unknown): DecodeResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: err(PROTOCOL_ERROR_CODES.BAD_ENVELOPE, 'envelope must be a non-null object'),
    };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: err(
        PROTOCOL_ERROR_CODES.BAD_VERSION,
        `unsupported protocol version: ${String(obj.v)}`,
      ),
    };
  }
  if (typeof obj.type !== 'string' || obj.type.length === 0) {
    return {
      ok: false,
      error: err(PROTOCOL_ERROR_CODES.BAD_TYPE, 'type must be a non-empty string'),
    };
  }
  if (!KNOWN_TYPES.has(obj.type)) {
    return {
      ok: false,
      error: err(PROTOCOL_ERROR_CODES.UNKNOWN_TYPE, `unknown message type: ${obj.type}`),
    };
  }
  if (!isFiniteNumber(obj.ts)) {
    return {
      ok: false,
      error: err(PROTOCOL_ERROR_CODES.BAD_TS, 'ts must be a finite number'),
    };
  }
  if (obj.id !== undefined) {
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
      return {
        ok: false,
        error: err(PROTOCOL_ERROR_CODES.BAD_ID, 'id must be a non-empty string when present'),
      };
    }
  }
  if (!('payload' in obj)) {
    return {
      ok: false,
      error: err(PROTOCOL_ERROR_CODES.BAD_PAYLOAD, 'payload is required'),
    };
  }

  const type = obj.type as MessageType;
  const checked = validatePayload(type, obj.payload);
  if (checked.error) {
    return { ok: false, error: checked.error };
  }

  const envelope: AxisEnvelope = {
    v: PROTOCOL_VERSION,
    type,
    payload: checked.payload,
    ts: obj.ts,
  };
  if (typeof obj.id === 'string') {
    envelope.id = obj.id;
  }
  return { ok: true, envelope };
}

/** Parse untrusted input. Never throws — returns a loggable error object. */
export function decode(raw: unknown): DecodeResult {
  try {
    return decodeInner(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: err(PROTOCOL_ERROR_CODES.BAD_ENVELOPE, `envelope access failed: ${message}`),
    };
  }
}

export function isHostToView(type: string): type is HostToViewType {
  return HOST_TO_VIEW_TYPES.has(type);
}

export function isViewToHost(type: string): type is ViewToHostType {
  return VIEW_TO_HOST_TYPES.has(type);
}

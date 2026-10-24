// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//

// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AXB1-Light WS engine live-wire module.
 *
 * Placeholder module for live-wire used by stream-live.ts and mcp/live.ts.
 * The AXB1-Light WS engine uses binary AXB1 frames over WebSocket.
 */

export interface EvalScriptInput {
  script: string;
  symbol: string;
  timeframe: string;
  inputs?: Record<string, unknown>;
  libraries?: Record<string, unknown>;
}

/** AXB1-Light WS fallback error. */
export class StreamFallbackError extends Error {
  /** Error code (e.g. 'no-auth', 'series-tick', 'eval'). */
  readonly code: string;

  constructor(codeOrMessage: string, message?: string) {
    if (message !== undefined) {
      super(message);
      this.code = codeOrMessage;
    } else {
      super(codeOrMessage);
      this.code = 'unknown';
    }
    this.name = 'StreamFallbackError';
  }
}

/** Legacy error message constant. */
export const StreamFallbackErrorMessage = 'AXB1-Light: use WS binary frames, not REST';

export type WireClient = {
  endpoint: string;
  apiKey: string;
};

/** Legacy wire client creator. */
export const WireClient = {
  create: (endpoint: string, apiKey: string): WireClient => ({
    endpoint,
    apiKey,
  }),
};

/**
 * AXB1-Light WS live wire client.
 *
 * Owns one WS connection per tab, built lazily from the active engine config.
 * Handlers paint series snapshots/deltas through the same store/chart helpers
 * the legacy path uses.
 */
export class StreamLiveWire {
  private readonly client: WireClient;
  private readonly onStatus?: (subId: string, status: string, extra: unknown) => void;
  private readonly onMalformed?: (raw: unknown) => void;
  private isConnected = false;

  /**
   * Create a new StreamLiveWire instance.
   * @param client - WireClient with endpoint and apiKey
   * @param options - Optional event handlers
   */
  constructor(
    client: WireClient,
    options?: {
      onStatus?: (subId: string, status: string, extra: unknown) => void;
      onMalformed?: (raw: unknown) => void;
    },
  ) {
    this.client = client;
    if (options) {
      this.onStatus = options.onStatus;
      this.onMalformed = options.onMalformed;
    }
  }

  /** Connect to the WebSocket and start receiving frames. */
  connect(): void {
    this.isConnected = true;
  }

  /** Disconnect the WebSocket. */
  disconnect(): void {
    this.isConnected = false;
  }

  /** Called for frames that fail contract validation (logged + skipped by default). */
  onFrame(_frame: unknown): void {
    // No-op for placeholder
  }

  /** Called when the connection status changes. */
  onStatus?(_subId: string, _status: string, _extra: unknown): void {
    // No-op for placeholder
  }

  /** Called for frames that fail contract validation. */
  onMalformed?(_raw: unknown): void {
    // No-op for placeholder
  }

  evaluate(
    script: string,
    symbol: string,
    timeframe: string,
    inputs?: unknown,
    libraries?: unknown,
  ): Promise<{ ok: boolean; plots: Array<{ name: string; value: number }> | null }> {
    return Promise.resolve({ ok: true, plots: null });
  }

  tick(bar: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    time: number;
  }): Promise<{ ok: boolean; plots: Array<{ name: string; value: number }> | null }> {
    return Promise.resolve({ ok: true, plots: null });
  }

  append(
    bars: Array<{
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      time: number;
    }>,
  ): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
}

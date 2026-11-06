/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * v1 transport flag (concept P1).
 *
 * The default is `worker`: `/ws/live` decode runs on the existing ingest
 * worker. `axis.engine.transport=json` is the rollback to main-thread parse.
 * The flag does not enable HP or SAB. AXB1 is negotiated when the worker
 * owns the socket. `axis.engine.encoding` selects `axb1-full` (the default,
 * all data over AXB1) or `axb1` (legacy: OHLCV + single-bar tips only).
 * A missing Worker counts one JSON fallback and stays up.
 *
 * @module engine/v1/transport
 */

import { getItem, removeItem, setItem, storageAvailable } from '../../utils/storage';
import { v1Count } from './metrics';

/** Which transport the tab uses for engine data: worker (AXB1 over the socket) or plain JSON. */
export type EngineTransport = 'json' | 'worker';
/** Binary encoding negotiated with the worker: `axb1-full` (default) or legacy `axb1`. */
export type EngineEncoding = 'axb1' | 'axb1-full';

/** localStorage key holding the transport opt-out; absent means `worker`. */
export const ENGINE_TRANSPORT_KEY = 'axis.engine.transport';
/** localStorage key holding the encoding opt-out; absent means `axb1-full`. */
export const ENGINE_ENCODING_KEY = 'axis.engine.encoding';

let memory: EngineTransport = 'worker';
let memoryEncoding: EngineEncoding = 'axb1-full';
let fallbackNoted = false;

/** `json` only when the tab set that value. Anything else is `worker`. */
export function engineTransport(): EngineTransport {
  if (!storageAvailable()) return memory;
  return getItem(ENGINE_TRANSPORT_KEY) === 'json' ? 'json' : 'worker';
}

/**
 * Persists the transport choice; `worker` is the default, so it removes the key instead of
 * writing one. Storage-unavailable tabs keep the value in memory only.
 *
 * @param mode Transport to use; anything other than `json` is stored as `worker`.
 * @example Roll a tab back to plain JSON after an AXB1 decode problem:
 * ```ts
 * setEngineTransport('json');
 * ```
 */
export function setEngineTransport(mode: EngineTransport): void {
  memory = mode === 'json' ? 'json' : 'worker';
  if (!storageAvailable()) return;
  if (memory === 'json') setItem(ENGINE_TRANSPORT_KEY, 'json');
  else removeItem(ENGINE_TRANSPORT_KEY);
}

/**
 * Binary negotiation token. `axb1-full` is the standard (all data over AXB1:
 * OHLCV, script snapshots/deltas, multi-bar deltas). `axb1` is the legacy
 * opt-out (OHLCV + single-bar tips only). JSON fallback is still accepted at
 * runtime for any shape the engine cannot represent losslessly.
 */
export function engineEncoding(): EngineEncoding {
  if (!storageAvailable()) return memoryEncoding;
  const stored = getItem(ENGINE_ENCODING_KEY);
  return stored === 'axb1' ? 'axb1' : 'axb1-full';
}

/**
 * Persists the encoding choice; `axb1-full` is the default, so it removes the key. The JSON
 * fallback stays available at runtime for shapes the engine cannot encode losslessly.
 *
 * @param encoding `axb1` to opt out of multi-bar/full AXB1, `axb1-full` for the default.
 */
export function setEngineEncoding(encoding: EngineEncoding): void {
  memoryEncoding = encoding === 'axb1' ? 'axb1' : 'axb1-full';
  if (!storageAvailable()) return;
  if (memoryEncoding === 'axb1-full') removeItem(ENGINE_ENCODING_KEY);
  else setItem(ENGINE_ENCODING_KEY, memoryEncoding);
}

/** True when this tab asked for the worker. Availability is the caller's job. */
export function wantsWorkerTransport(): boolean {
  return engineTransport() === 'worker';
}

/** Count one JSON fallback per tab when the worker was requested and missing. */
export function noteWorkerTransportFallback(): void {
  if (fallbackNoted) return;
  fallbackNoted = true;
  v1Count('jsonFallback');
}

/** Tests: back to the `worker`/`axb1-full` defaults, fallback counter armed again. */
export function resetEngineTransport(): void {
  memory = 'worker';
  memoryEncoding = 'axb1-full';
  fallbackNoted = false;
  removeItem(ENGINE_TRANSPORT_KEY);
  removeItem(ENGINE_ENCODING_KEY);
}

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
 * owns the socket. A missing Worker counts one JSON fallback and stays up.
 *
 * @module engine/v1/transport
 */

import { getItem, removeItem, setItem, storageAvailable } from '../../utils/storage';
import { v1Count } from './metrics';

export type EngineTransport = 'json' | 'worker';

export const ENGINE_TRANSPORT_KEY = 'axis.engine.transport';

let memory: EngineTransport = 'worker';
let fallbackNoted = false;

/** `json` only when the tab set that value. Anything else is `worker`. */
export function engineTransport(): EngineTransport {
  if (!storageAvailable()) return memory;
  return getItem(ENGINE_TRANSPORT_KEY) === 'json' ? 'json' : 'worker';
}

export function setEngineTransport(mode: EngineTransport): void {
  memory = mode === 'json' ? 'json' : 'worker';
  if (!storageAvailable()) return;
  if (memory === 'json') setItem(ENGINE_TRANSPORT_KEY, 'json');
  else removeItem(ENGINE_TRANSPORT_KEY);
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

/** Tests: back to the worker default, fallback counter armed again. */
export function resetEngineTransport(): void {
  memory = 'worker';
  fallbackNoted = false;
  removeItem(ENGINE_TRANSPORT_KEY);
}

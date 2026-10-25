/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * v1 transport flag (concept P1).
 *
 * `axis.engine.transport=worker` moves `/ws/live` decode onto the existing
 * ingest worker. The default stays `json` (main-thread parse) until P2.
 * The flag does not enable HP, SAB, or AXB1 negotiation — the worker still
 * accepts whatever the server sends, and today that is JSON.
 *
 * @module engine/v1/transport
 */

import { getItem, removeItem, setItem, storageAvailable } from '../../utils/storage';
import { v1Count } from './metrics';

export type EngineTransport = 'json' | 'worker';

export const ENGINE_TRANSPORT_KEY = 'axis.engine.transport';

let memory: EngineTransport = 'json';
let fallbackNoted = false;

/** `worker` only when the tab set that value. Anything else is `json`. */
export function engineTransport(): EngineTransport {
  if (!storageAvailable()) return memory;
  return getItem(ENGINE_TRANSPORT_KEY) === 'worker' ? 'worker' : 'json';
}

export function setEngineTransport(mode: EngineTransport): void {
  memory = mode === 'worker' ? 'worker' : 'json';
  if (!storageAvailable()) return;
  if (memory === 'worker') setItem(ENGINE_TRANSPORT_KEY, 'worker');
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

/** Tests: back to main-thread JSON, fallback counter armed again. */
export function resetEngineTransport(): void {
  memory = 'json';
  fallbackNoted = false;
  removeItem(ENGINE_TRANSPORT_KEY);
}

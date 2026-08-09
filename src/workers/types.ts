// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Types for the AXIS Workers Manager — catalog entries, health probes, install steps.
 *
 * @module workers/types
 */

/** Stable catalog id for a known runtime / edge service. */
export type WorkerId =
  | 'pyne-pro'
  | 'axis-worker'
  | 'axis-worker-local'
  | 'pyodide'
  | 'pyne-agent'
  | 'service-worker'
  | 'pyne-worker';

/** High-level role a worker plays for AXIS. */
export type WorkerRole =
  | 'calc'
  | 'proxy'
  | 'onchain'
  | 'scripts'
  | 'stream'
  | 'agent'
  | 'pwa'
  | 'oauth';

/** Health classification after probe. */
export type WorkerHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'idle' | 'skipped';

/** How AXIS talks to the worker (for overview badges). */
export type WorkerKind =
  | 'process'
  | 'edge'
  | 'browser'
  | 'pwa'
  | 'optional';

/** One install / setup step shown in the Install tab. */
export interface WorkerInstallStep {
  /** Short title (e.g. "Install deps"). */
  title: string;
  /** Human description. */
  detail: string;
  /** Optional shell / URL to copy. */
  command?: string;
}

/** Static catalog entry (no live status). */
export interface WorkerCatalogEntry {
  id: WorkerId;
  name: string;
  /** One-line summary for cards. */
  summary: string;
  /** Longer overview for Detail tab. */
  description: string;
  kind: WorkerKind;
  roles: WorkerRole[];
  /** Default base URL when applicable (empty for browser/SW). */
  defaultEndpoint: string;
  /** Suggested local endpoint (wrangler / Flask). */
  localEndpoint?: string;
  /** Production / docs links. */
  docsPath?: string;
  homepage?: string;
  /** Install / setup steps. */
  install: WorkerInstallStep[];
  /** Capability tags for badges. */
  capabilities: string[];
  /** Whether this can be set as `store.endpoint` for server engine. */
  canUseAsBackend: boolean;
  /** Whether selecting this switches engine to pyodide. */
  canUseAsEngine?: boolean;
  /** Optional plugin URL (agent). */
  pluginUrl?: string;
  /** Probe strategy id. */
  probe: 'http-health' | 'pyodide' | 'service-worker' | 'none';
  /**
   * HTTP health paths to try (relative to base). First JSON-looking success wins.
   * Only for `probe: 'http-health'`.
   */
  healthPaths?: string[];
  /** Required JSON keys that mark a healthy HTTP response (any match). */
  healthMarkers?: string[];
  /** Expected `service` string fragment when present. */
  serviceHint?: string;
  /** Optional — not required for basic AXIS charting. */
  optional?: boolean;
}

/** Live probe result for one catalog entry. */
export interface WorkerProbeResult {
  id: WorkerId;
  status: WorkerHealthStatus;
  /** Milliseconds for the probe round-trip (null if skipped / N/A). */
  latencyMs: number | null;
  /** Human-readable status line. */
  detail: string;
  /** Endpoint that was probed (if any). */
  endpoint: string;
  /** Feature flags / body fields when available. */
  features: Record<string, boolean | string | number | null>;
  /** Raw service name from health JSON. */
  service: string | null;
  /** Epoch ms of this probe. */
  checkedAt: number;
  /** Error message if down. */
  error: string | null;
  /** True when this endpoint matches current store.endpoint. */
  isActiveBackend: boolean;
  /** True when this worker is the active calculation path. */
  isActiveEngine: boolean;
}

/** Snapshot for the whole manager UI. */
export interface WorkersOverviewSnapshot {
  results: WorkerProbeResult[];
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
  checkedAt: number;
}

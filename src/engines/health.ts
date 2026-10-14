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
 * PYNE `/health` capability model.
 *
 * `GET /health` is the backend's discovery surface: `features.*` advertises
 * optional routes, `compile.*` reports Numba / IR-cache readiness, and
 * `endpoints` names every route the host serves. AXIS currently consumes only
 * the live-mode subset (see `capabilitiesFromHealth` in `./catalog`); this
 * module keeps the rest typed so the UI can show readiness and gate optional
 * surfaces without re-fetching.
 *
 * Parsing is deliberately conservative: nothing is inferred from the service
 * name, unknown or malformed keys degrade to `null` / `false`, and the parser
 * never throws (health is a hint, not a contract).
 *
 * @module engines/health
 */

/** `compile` section — Numba / IR cache readiness (see PYNE `_compile_health_section`). */
export interface EngineCompileHealth {
  /** Numba importable in the backend process. */
  hasNumba: boolean;
  /** Shared builtin kernels warmed (first-run JIT paid). */
  builtinsWarmed: boolean;
  /** `POST /compile/prewarm` allowed / meaningful for this host. */
  prewarmEnabled: boolean;
  /** This host already served a prewarm since boot. */
  hostPrewarmed: boolean;
  /** Compiled IR persisted to disk across restarts. */
  diskCacheEnabled: boolean;
  diskCacheDir: string | null;
  /** Cached source programs. */
  sourceEntries: number | null;
  /** Cached compiled IR programs. */
  irEntries: number | null;
  /** Backend default runtime mode (`auto` / `interpret` / `compile`). */
  defaultMode: string | null;
}

/** `features.*` — optional routes and policies this host advertises. */
export interface EngineFeatureHealth {
  /** Warm compile available (mode `auto` pays JIT on first run otherwise). */
  warmCompile: boolean;
  /** `POST /optimize` available. */
  optimize: boolean;
  /** Alert evaluation available in run payloads. */
  alerts: boolean;
  /** Server-side alert forwarding to a webhook. */
  alertWebhooks: boolean;
  /** A default alert webhook is configured on the host. */
  alertWebhookDefault: boolean;
  /** Backend default run mode, when advertised. */
  defaultRunMode: string | null;
  /** Unauthenticated `/run` guards are opted in. */
  freeTierLimits: boolean;
  /** Hosted script runner (`/scripts`, `/cron/*`) is enabled. */
  scriptRunner: boolean;
  /** Runner poll scheduler is enabled. */
  scriptRunnerScheduler: boolean;
}

/** Parsed `GET /health` payload (identity + optional capability sections). */
export interface EngineHealth {
  service: string | null;
  version: string | null;
  /** WebSocket run channel present (`WS /ws/run`). */
  websocket: boolean;
  compile: EngineCompileHealth | null;
  features: EngineFeatureHealth | null;
  /** Advertised route keys, e.g. `POST /compile/prewarm`. */
  endpoints: string[];
}

/** Health for an endpoint that did not answer or predates the capability keys. */
export const DEFAULT_ENGINE_HEALTH: EngineHealth = {
  service: null,
  version: null,
  websocket: false,
  compile: null,
  features: null,
  endpoints: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function bool(v: unknown): boolean {
  return v === true;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseCompile(raw: unknown): EngineCompileHealth | null {
  if (!isRecord(raw)) return null;
  return {
    hasNumba: bool(raw.has_numba),
    builtinsWarmed: bool(raw.builtins_warmed),
    prewarmEnabled: bool(raw.prewarm_enabled),
    hostPrewarmed: bool(raw.host_prewarmed),
    diskCacheEnabled: bool(raw.disk_cache_enabled),
    diskCacheDir: str(raw.disk_cache_dir),
    sourceEntries: num(raw.source_entries),
    irEntries: num(raw.ir_entries),
    defaultMode: str(raw.default_mode),
  };
}

function parseFeatures(raw: unknown): EngineFeatureHealth | null {
  if (!isRecord(raw)) return null;
  return {
    warmCompile: bool(raw.warm_compile),
    optimize: bool(raw.optimize),
    alerts: bool(raw.alerts),
    alertWebhooks: bool(raw.alert_webhooks),
    alertWebhookDefault: bool(raw.alert_webhook_default),
    defaultRunMode: str(raw.default_run_mode),
    freeTierLimits: bool(raw.free_tier_limits),
    scriptRunner: bool(raw.script_runner),
    scriptRunnerScheduler: bool(raw.script_runner_scheduler),
  };
}

function parseEndpoints(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  return Object.keys(raw).filter((k) => k.trim().length > 0);
}

/**
 * Map a `GET /health` body to {@link EngineHealth}. Never throws; a non-object
 * body (HTML shell, empty reply) yields {@link DEFAULT_ENGINE_HEALTH}.
 */
export function healthFromBody(body: unknown): EngineHealth {
  if (!isRecord(body)) return { ...DEFAULT_ENGINE_HEALTH };
  return {
    service: str(body.service),
    version: str(body.version),
    websocket: bool(body.websocket),
    compile: parseCompile(body.compile),
    features: parseFeatures(body.features),
    endpoints: parseEndpoints(body.endpoints),
  };
}

/** True when `/health` advertised the exact route (e.g. `POST /compile/prewarm`). */
export function healthAdvertises(health: EngineHealth, route: string): boolean {
  return health.endpoints.includes(route);
}

/** A run mode the backend actually supports. */
export type AdvertisedRunMode = 'interpret' | 'compile' | 'auto';

/**
 * The backend's own default run mode, when advertised.
 *
 * `compile.default_mode` is the runtime's configured default; `features.default_run_mode`
 * is the same value surfaced as a feature. Used to seed the Runtime form's
 * execution mode when the user has not saved one — never to override an
 * explicit choice.
 */
export function advertisedRunMode(health: EngineHealth | null): AdvertisedRunMode | null {
  const raw = health?.compile?.defaultMode ?? health?.features?.defaultRunMode ?? null;
  const mode = String(raw || '').trim().toLowerCase();
  return mode === 'interpret' || mode === 'compile' || mode === 'auto' ? mode : null;
}

/**
 * Human-readable compile readiness for the UI.
 *
 * `cold` — Numba present but nothing warmed yet (first compile pays JIT).
 * `warm` — builtins warmed in this process, or the host already prewarmed.
 * `unavailable` — no Numba; compile still works in object mode.
 * `unknown` — no `compile` section (older backend / unreachable).
 */
export type CompileReadiness = 'warm' | 'cold' | 'unavailable' | 'unknown';

export function compileReadiness(health: EngineHealth | null): CompileReadiness {
  if (!health?.compile) return 'unknown';
  const c = health.compile;
  if (!c.hasNumba) return 'unavailable';
  if (c.builtinsWarmed || c.hostPrewarmed) return 'warm';
  return 'cold';
}

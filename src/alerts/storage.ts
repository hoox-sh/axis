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
 * Local-first alert persistence (`axis.alerts.v1`).
 *
 * Primary backend: `localStorage`. Falls back to an in-memory map when
 * localStorage is unavailable (SSR / restricted contexts / tests without LS).
 *
 * @module alerts/storage
 */

import type { Alert, AlertsStoreV1 } from './types';

/** localStorage key for the alerts blob. */
export const ALERTS_STORAGE_KEY = 'axis.alerts.v1';

/** In-memory fallback when localStorage is missing or throws. */
let memoryStore: Alert[] | null = null;

function lsAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

function lsGet(key: string): string | null {
  try {
    if (!lsAvailable()) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): boolean {
  try {
    if (!lsAvailable()) return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key: string): void {
  try {
    if (!lsAvailable()) return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Validate and coerce a raw object into an Alert, or null if unusable. */
export function parseAlert(raw: unknown): Alert | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.name !== 'string') return null;
  if (typeof o.symbol !== 'string') return null;
  if (typeof o.kind !== 'string') return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) return null;

  const params =
    o.params && typeof o.params === 'object' && !Array.isArray(o.params)
      ? ({ ...(o.params as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const alert: Alert = {
    id: o.id,
    name: o.name,
    enabled: o.enabled !== false,
    symbol: o.symbol,
    kind: o.kind as Alert['kind'],
    params,
    createdAt: o.createdAt,
  };

  if (typeof o.interval === 'string' && o.interval) alert.interval = o.interval;
  if (typeof o.webhookUrl === 'string' && o.webhookUrl) alert.webhookUrl = o.webhookUrl;
  if (typeof o.notifyBrowser === 'boolean') alert.notifyBrowser = o.notifyBrowser;
  if (typeof o.cooldownMs === 'number' && Number.isFinite(o.cooldownMs)) {
    alert.cooldownMs = o.cooldownMs;
  }
  if (typeof o.lastFiredAt === 'number' && Number.isFinite(o.lastFiredAt)) {
    alert.lastFiredAt = o.lastFiredAt;
  }

  return alert;
}

/** Parse the storage blob; returns [] on missing/corrupt data. */
export function parseAlertsBlob(raw: string | null): Alert[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (Array.isArray(data)) {
      return data.map(parseAlert).filter((a): a is Alert => a != null);
    }
    if (data && typeof data === 'object') {
      const blob = data as Partial<AlertsStoreV1>;
      if (Array.isArray(blob.alerts)) {
        return blob.alerts.map(parseAlert).filter((a): a is Alert => a != null);
      }
    }
  } catch {
    /* corrupt */
  }
  return [];
}

function serialize(alerts: Alert[]): string {
  const blob: AlertsStoreV1 = { version: 1, alerts };
  return JSON.stringify(blob);
}

/**
 * Load all alerts from localStorage (or memory fallback).
 * Always returns a new array of shallow-cloned alerts.
 */
export function loadAlerts(): Alert[] {
  const raw = lsGet(ALERTS_STORAGE_KEY);
  if (raw != null) {
    const list = parseAlertsBlob(raw);
    memoryStore = list.map((a) => ({ ...a, params: { ...a.params } }));
    return memoryStore.map((a) => ({ ...a, params: { ...a.params } }));
  }
  if (memoryStore) {
    return memoryStore.map((a) => ({ ...a, params: { ...a.params } }));
  }
  return [];
}

/**
 * Persist the full alert list. Updates memory fallback always;
 * writes localStorage when available.
 */
export function saveAlerts(alerts: Alert[]): void {
  const copy = alerts.map((a) => ({ ...a, params: { ...a.params } }));
  memoryStore = copy;
  const json = serialize(copy);
  if (!lsSet(ALERTS_STORAGE_KEY, json)) {
    // localStorage unavailable — memory only (already set)
  }
}

/** Replace one alert by id (or no-op if missing). Returns updated list. */
export function upsertAlert(alert: Alert): Alert[] {
  const list = loadAlerts();
  const idx = list.findIndex((a) => a.id === alert.id);
  if (idx >= 0) list[idx] = { ...alert, params: { ...alert.params } };
  else list.push({ ...alert, params: { ...alert.params } });
  saveAlerts(list);
  return list;
}

/** Remove alert by id. Returns whether something was removed. */
export function removeAlert(id: string): boolean {
  const list = loadAlerts();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  saveAlerts(next);
  return true;
}

/** Clear all alerts from storage (tests). */
export function clearAlertsStorage(): void {
  memoryStore = null;
  lsRemove(ALERTS_STORAGE_KEY);
}

/** Test helper: seed memory without touching a real LS if desired. */
export function _setMemoryAlertsForTests(alerts: Alert[] | null): void {
  memoryStore = alerts
    ? alerts.map((a) => ({ ...a, params: { ...a.params } }))
    : null;
}

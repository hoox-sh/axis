// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SSR-safe localStorage accessors with one error policy: never throw.
 *
 * Eight call sites across four modules each owned a `lsGet` / `lsSet` /
 * `lsRemove` triple (plus ad-hoc `typeof localStorage` guards at ~30 more),
 * differing only in whether a failed write returned `false` or `void`.
 * This module is the single definition; the boolean return is kept because
 * the alerts persist path reports quota failures to the user.
 *
 * @module utils/storage
 */

/** False when there is no usable Web Storage (SSR, tests, blocked). */
export function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage != null;
  } catch {
    return false;
  }
}

/** Read a raw string. `null` when missing, unavailable, or unreadable. */
export function getItem(key: string): string | null {
  try {
    if (!storageAvailable()) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a raw string. Returns `false` (instead of throwing) when storage is
 * unavailable or the write fails (quota / private mode).
 */
export function setItem(key: string, value: string): boolean {
  try {
    if (!storageAvailable()) return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove a key. Never throws; no-op when storage is unavailable. */
export function removeItem(key: string): void {
  try {
    if (!storageAvailable()) return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Read + `JSON.parse` a value. `null` when missing, corrupt, or unreadable. */
export function getJson<T>(key: string): T | null {
  const raw = getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** `JSON.stringify` + write. Returns `false` when the value is unserializable or unwritable. */
export function setJson(key: string, value: unknown): boolean {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  return setItem(key, raw);
}

/** True when the key holds the `'1'` flag (feature-flag convention). */
export function getFlag(key: string): boolean {
  return getItem(key) === '1';
}

/** Write `'1'` (or remove the key when off). Never throws. */
export function setFlag(key: string, on: boolean): void {
  if (on) setItem(key, '1');
  else removeItem(key);
}

// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tab-local opt-in flag with a kill switch (`engine/feature-flag`).
 *
 * An `enabled` key, a `disabled` key, in-memory fallbacks for tests/SSR,
 * and one precedence rule — the opt-out wins over everything.
 *
 * Storage itself never throws (see `utils/storage`); the memory fallback
 * only matters when `localStorage` is entirely absent.
 *
 * @module utils/flags
 */

import { getFlag, removeItem, setItem } from './storage';

export interface FlagPairOptions {
  /** Tab-local opt-in key (`'1'` = on). */
  enabledKey: string;
  /** Tab-local kill-switch key (`'1'` = off, wins over everything). */
  disabledKey: string;
}

export interface FlagPair {
  /** True when opted in and the kill switch is off. */
  isEnabled(): boolean;
  /** True when explicitly opted out. */
  isDisabled(): boolean;
  /** Opt in (`true`) or out (`false`); clears the opposite key. */
  setEnabled(on: boolean): void;
  /** Set or clear the kill switch alone. */
  setDisabled(on: boolean): void;
  /** Clear memory + storage (tests). */
  reset(): void;
}

/** A kill-switch-guarded flag pair over two localStorage keys. */
export function createFlagPair({ enabledKey, disabledKey }: FlagPairOptions): FlagPair {
  let memoryOn = false;
  let memoryOff = false;

  return {
    isEnabled(): boolean {
      if (this.isDisabled()) return false;
      if (typeof localStorage === 'undefined') return memoryOn;
      return getFlag(enabledKey);
    },
    isDisabled(): boolean {
      if (typeof localStorage === 'undefined') return memoryOff;
      return getFlag(disabledKey) || memoryOff;
    },
    setEnabled(on: boolean): void {
      memoryOn = on;
      memoryOff = !on;
      if (on) {
        setItem(enabledKey, '1');
        removeItem(disabledKey);
      } else {
        removeItem(enabledKey);
        setItem(disabledKey, '1');
      }
    },
    setDisabled(on: boolean): void {
      memoryOff = on;
      if (on) setItem(disabledKey, '1');
      else removeItem(disabledKey);
    },
    reset(): void {
      memoryOn = false;
      memoryOff = false;
      removeItem(enabledKey);
      removeItem(disabledKey);
    },
  };
}

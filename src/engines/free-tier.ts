// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guest PYNE hosts refuse windows above this with `413` / `TOO_MANY_BARS`.
 * Authenticated hosts may accept more; the client retries with the newest
 * slice instead of pre-capping every run.
 */
export const GUEST_ENGINE_BAR_CAP = 5_000;

const guestBarCapByEndpoint = new Map<string, number>();

function guestCapKey(endpoint: string): string {
  return String(endpoint || '').trim().replace(/\/$/, '');
}

/** Remember a free-tier refusal so the next run sends the capped window first. */
export function rememberGuestBarCap(endpoint: string, cap: number): void {
  const key = guestCapKey(endpoint);
  if (!key || !(cap > 0)) return;
  const prev = guestBarCapByEndpoint.get(key);
  if (prev == null || cap < prev) guestBarCapByEndpoint.set(key, Math.floor(cap));
}

/** Last learned guest cap for this endpoint, or 0 when none. */
export function rememberedGuestBarCap(endpoint: string): number {
  return guestBarCapByEndpoint.get(guestCapKey(endpoint)) ?? 0;
}

/**
 * Newest `cap` bars when this guest endpoint has already been refused.
 * A key means the host may accept the full window, so the cap is not applied.
 */
export function barsWithinGuestCap<T>(
  endpoint: string,
  bars: readonly T[],
  hasKey: boolean,
): { bars: T[]; cap: number } {
  if (hasKey) return { bars: bars as T[], cap: 0 };
  const cap = rememberedGuestBarCap(endpoint);
  if (cap > 0 && bars.length > cap) return { bars: bars.slice(-cap), cap };
  return { bars: bars as T[], cap: 0 };
}

/** @internal */
export function _resetGuestBarCapForTests(): void {
  guestBarCapByEndpoint.clear();
}

/**
 * Bar cap from a free-tier refusal.
 *
 * Accepts a parsed engine body (`max_bars`, `code`, `message` / `error`) or
 * the raw response text. `0` means the payload is not a bar-cap error.
 */
export function freeTierMaxBars(source: unknown): number {
  if (typeof source === 'string') {
    const fromText = source.match(/free-tier limit \((\d+)\s*bars\)/i);
    if (fromText) return Number(fromText[1]);
    if (/TOO_MANY_BARS|free-tier limit/i.test(source)) return GUEST_ENGINE_BAR_CAP;
    return 0;
  }
  if (!source || typeof source !== 'object') return 0;
  const rec = source as Record<string, unknown>;
  const n = Number(rec['max_bars'] ?? rec['maxBars']);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const msg = String(rec['message'] || rec['error'] || '');
  const fromMsg = msg.match(/free-tier limit \((\d+)\s*bars\)/i);
  if (fromMsg) return Number(fromMsg[1]);
  const code = String(rec['code'] || '');
  if (/TOO_MANY_BARS/i.test(code) || /free-tier limit/i.test(msg)) return GUEST_ENGINE_BAR_CAP;
  return 0;
}

// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guest PYNE hosts refuse windows above this with `413` / `TOO_MANY_BARS`.
 * Authenticated hosts may accept more; the client retries with the newest
 * slice instead of pre-capping every run.
 */
export const GUEST_ENGINE_BAR_CAP = 5_000;

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

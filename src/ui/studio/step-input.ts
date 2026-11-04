// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Numeric stepper helper (no JSX — testable without a DOM).
 *
 * @module ui/studio/step-input
 */

/**
 * Advance a native `<input type="number">` one step.
 *
 * `stepUp` / `stepDown` dispatch their own native `input` + `change` events, so
 * the caller must not forward the value again. Returns the new value, or `null`
 * when the element refuses the step (non-numeric input, invalid step).
 */
export function stepNativeInput(
  el: { stepUp: () => void; stepDown: () => void; value: string },
  direction: 1 | -1,
): string | null {
  try {
    if (direction > 0) el.stepUp();
    else el.stepDown();
  } catch {
    return null;
  }
  return el.value;
}

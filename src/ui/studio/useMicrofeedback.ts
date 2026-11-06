/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * useMicrofeedback — the "perfect concept" as a reusable primitive.
 * Three layers, one hook:
 *
 *   contact  — instant acknowledge (<50ms): press scale + ripple, pure CSS.
 *   process  — async work: `loading`, aria-busy, height-stable label swap.
 *   outcome  — `success` (900ms check hold) or `error` (shake + red edge),
 *              then back to idle. Pair with a toast / status capsule for
 *              the ambient layer so the button itself stays quiet.
 *
 * Controlled or fire-and-forget:
 *   const fb = useMicrofeedback({ afterSuccess: close });
 *   <AppButton feedback={fb.state()} onClick={() => fb.run(save)} />
 *
 * @module ui/studio/useMicrofeedback
 */

import { createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { FeedbackState } from './AppButton';

/**
 * Drive the contact → process → outcome feedback cycle for one async action.
 *
 * `run` refuses to start while already loading, sets `loading`, then holds
 * `success` or `error` for the configured window before returning to `idle`.
 * A rejection is swallowed (returns `undefined`) after `onError` runs, so
 * callers get fire-and-forget semantics; the timer is cleared on cleanup.
 *
 * @param options - Hold durations and success/error lifecycle callbacks.
 * @returns `state` accessor, `run` wrapper, `reset`, and the raw `settle`.
 */
export function useMicrofeedback(options?: {
  successHoldMs?: number;
  errorHoldMs?: number;
  /** Fires when the action resolves successfully (start of success hold). */
  onSuccess?: () => void;
  /** Fires when the action rejects (start of error hold). */
  onError?: (err: unknown) => void;
  /** Fires when the success hold ends and the button returns to idle. */
  afterSuccess?: () => void;
  /** Fires when the error hold ends and the button returns to idle. */
  afterError?: () => void;
}): {
  state: Accessor<FeedbackState>;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  reset: () => void;
  settle: (next: Exclude<FeedbackState, 'idle' | 'loading'>, hold: number) => void;
} {
  const successHold = options?.successHoldMs ?? 900;
  const errorHold = options?.errorHoldMs ?? 900;
  const [state, setState] = createSignal<FeedbackState>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const settle = (next: Exclude<FeedbackState, 'idle' | 'loading'>, hold: number) => {
    setState(next);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      setState('idle');
      if (next === 'success') options?.afterSuccess?.();
      else options?.afterError?.();
    }, hold);
  };

  /** Wrap an async action with loading → success/error feedback. */
  const run = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (state() === 'loading') return undefined;
    setState('loading');
    try {
      const out = await fn();
      settle('success', successHold);
      options?.onSuccess?.();
      return out;
    } catch (err) {
      settle('error', errorHold);
      options?.onError?.(err);
      return undefined;
    }
  };

  const reset = () => {
    if (timer) clearTimeout(timer);
    setState('idle');
  };

  return { state, run, reset, settle };
}

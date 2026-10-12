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
 *   const fb = useMicrofeedback();
 *   <AppButton feedback={fb.state()} onClick={() => fb.run(save)} />
 *
 * @module ui/studio/useMicrofeedback
 */

import { createSignal, onCleanup } from 'solid-js';
import type { FeedbackState } from './AppButton';

export function useMicrofeedback(options?: {
  successHoldMs?: number;
  errorHoldMs?: number;
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}) {
  const successHold = options?.successHoldMs ?? 900;
  const errorHold = options?.errorHoldMs ?? 900;
  const [state, setState] = createSignal<FeedbackState>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const settle = (next: FeedbackState, hold: number) => {
    setState(next);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setState('idle'), hold);
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

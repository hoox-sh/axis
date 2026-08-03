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
 * Recoverable error UI for Solid {@link ErrorBoundary} fallbacks.
 *
 * - `page` — full-viewport void chrome (root boot death)
 * - `inline` — compact panel for chart / dock regions (shell stays up)
 *
 * @module ui/ErrorFallback
 */

import { Component, Show } from 'solid-js';
import { formatErrorMessage } from './boot-errors';

export interface ErrorFallbackProps {
  error: unknown;
  /** Solid ErrorBoundary reset — re-renders children. */
  reset?: () => void;
  variant?: 'page' | 'inline';
  /** Short heading (default depends on variant). */
  title?: string;
  /** Extra context for system logs / support (e.g. "chart"). */
  source?: string;
}

/** Void-theme recoverable error surface. */
export const ErrorFallback: Component<ErrorFallbackProps> = (props) => {
  const variant = () => props.variant || 'page';
  const title = () =>
    props.title ||
    (variant() === 'inline' ? 'Chart failed' : 'Something went wrong');
  const message = () => formatErrorMessage(props.error);

  const reload = () => {
    if (typeof location !== 'undefined') location.reload();
  };

  if (variant() === 'inline') {
    return (
      <div
        class="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center gap-3 px-4 py-6 bg-bg-base text-text"
        data-testid="axis-error-fallback"
        data-variant="inline"
        data-source={props.source || undefined}
        role="alert"
      >
        <div class="text-[11px] tracking-[0.18em] uppercase font-medium text-red">
          {title()}
        </div>
        <p class="text-[11px] text-text-dim font-mono text-center max-w-md break-words">
          {message()}
        </p>
        <div class="flex items-center gap-2 mt-1">
          <Show when={props.reset}>
            <button
              type="button"
              class="sc-btn sc-btn-primary px-2.5 py-1 text-[11px]"
              data-testid="axis-error-retry"
              onClick={() => props.reset?.()}
            >
              Retry
            </button>
          </Show>
          <button
            type="button"
            class="sc-btn px-2.5 py-1 text-[11px]"
            data-testid="axis-error-reload"
            onClick={reload}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      class="h-screen w-screen flex flex-col items-center justify-center gap-4 px-6 bg-bg-base text-text"
      data-testid="axis-error-fallback"
      data-variant="page"
      data-source={props.source || undefined}
      role="alert"
    >
      <div class="text-accent text-[10px] tracking-[0.22em] uppercase font-medium">
        AXIS
      </div>
      <div class="text-sm font-medium text-red">{title()}</div>
      <p class="text-[12px] text-text-dim font-mono text-center max-w-lg break-words leading-relaxed">
        {message()}
      </p>
      <p class="text-[11px] text-text-faint text-center max-w-md">
        The workspace hit an unexpected error. Retry to remount, or reload the
        page. Check System logs for details.
      </p>
      <div class="flex items-center gap-2 mt-2">
        <Show when={props.reset}>
          <button
            type="button"
            class="sc-btn sc-btn-primary px-3 py-1.5 text-[12px]"
            data-testid="axis-error-retry"
            onClick={() => props.reset?.()}
          >
            Retry
          </button>
        </Show>
        <button
          type="button"
          class="sc-btn px-3 py-1.5 text-[12px]"
          data-testid="axis-error-reload"
          onClick={reload}
        >
          Reload page
        </button>
      </div>
    </div>
  );
};

/**
 * Solid ErrorBoundary `fallback` factory — logs once via optional hook.
 * Usage: `fallback={errorFallback({ source: 'root' })}`
 */
export function errorFallback(opts?: {
  variant?: 'page' | 'inline';
  title?: string;
  source?: string;
  onError?: (err: unknown) => void;
}): (err: unknown, reset: () => void) => ReturnType<typeof ErrorFallback> {
  return (err, reset) => {
    opts?.onError?.(err);
    return (
      <ErrorFallback
        error={err}
        reset={reset}
        variant={opts?.variant}
        title={opts?.title}
        source={opts?.source}
      />
    );
  };
}

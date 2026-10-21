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
 * Topbar screenshot control — popover for scope / scale / drawings / watermark,
 * then copy or download PNG.
 *
 * @module ui/ScreenshotMenu
 */

import { type Component, For, createSignal } from 'solid-js';
import { setStatus } from '../store';
import { reportUiError } from './boot-errors';
import { Icons } from './icons';
import { Popover } from './Popover';
import {
  copyScreenshot,
  downloadScreenshot,
  loadScreenshotOptions,
  saveScreenshotOptions,
  type ScreenshotOptions,
  type ScreenshotScope,
} from '../chart/screenshot';

const SCOPES: Array<{ id: ScreenshotScope; label: string; hint: string }> = [
  { id: 'price', label: 'Price', hint: 'Price pane only' },
  { id: 'panes', label: 'Panes', hint: 'Price + volume + studies' },
  { id: 'workspace', label: 'Workspace', hint: 'Stacked panes + header' },
];

export const ScreenshotMenu: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [opts, setOpts] = createSignal<ScreenshotOptions>(loadScreenshotOptions());
  let btnEl: HTMLButtonElement | undefined;

  const close = () => setOpen(false);

  const patch = (next: Partial<ScreenshotOptions>) => {
    const merged = { ...opts(), ...next };
    setOpts(merged);
    saveScreenshotOptions(merged);
  };

  const run = async (mode: 'copy' | 'download') => {
    if (busy()) return;
    setBusy(true);
    try {
      const current = opts();
      saveScreenshotOptions(current);
      if (mode === 'copy') await copyScreenshot(current);
      else await downloadScreenshot(current);
      close();
    } catch (err: unknown) {
      reportUiError(err, {
        source: 'chart',
        context: 'Screenshot failed',
        status: true,
      });
      const msg = err instanceof Error ? err.message : 'Screenshot failed';
      setStatus('error', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="relative" data-testid="axis-screenshot-menu">
      <button
        ref={btnEl}
        type="button"
        class={`sc-btn sc-btn-ghost sc-btn-icon ${open() ? 'is-active' : ''}`}
        title="Screenshot — capture chart panes"
        aria-label="Screenshot"
        aria-haspopup="dialog"
        aria-expanded={open()}
        data-testid="axis-btn-screenshot"
        disabled={busy()}
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) setOpts(loadScreenshotOptions());
            return next;
          });
        }}
      >
        <Icons.screenshot />
      </button>

      <Popover
        open={open()}
        anchor={btnEl}
        onClose={close}
        width={280}
        class="sc-popover w-[min(280px,calc(100vw-24px))] p-2 flex flex-col gap-2"
        role="dialog"
        label="Screenshot options"
        testId="axis-screenshot-popover"
      >
            <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold px-0.5">
              Capture
            </div>
            <div class="grid grid-cols-3 gap-1">
              <For each={SCOPES}>
                {(s) => (
                  <button
                    type="button"
                    class={`sc-btn py-1.5 text-[11px] ${
                      opts().scope === s.id ? 'sc-btn-primary is-active' : 'sc-btn-ghost'
                    }`}
                    title={s.hint}
                    data-testid={`axis-screenshot-scope-${s.id}`}
                    onClick={() => patch({ scope: s.id })}
                  >
                    {s.label}
                  </button>
                )}
              </For>
            </div>

            <label class="flex items-center gap-2 px-0.5 text-[11px] text-text-dim cursor-pointer">
              <input
                type="checkbox"
                checked={opts().includeDrawings}
                data-testid="axis-screenshot-drawings"
                onChange={(e) => patch({ includeDrawings: e.currentTarget.checked })}
              />
              Include drawings
            </label>
            <label class="flex items-center gap-2 px-0.5 text-[11px] text-text-dim cursor-pointer">
              <input
                type="checkbox"
                checked={opts().includeWatermark}
                data-testid="axis-screenshot-watermark"
                onChange={(e) => patch({ includeWatermark: e.currentTarget.checked })}
              />
              Watermark (symbol · time)
            </label>

            <div class="flex items-center justify-between gap-2 px-0.5">
              <span class="text-[11px] text-text-dim">Scale</span>
              <div class="inline-flex gap-1">
                <button
                  type="button"
                  class={`sc-btn py-1 px-2 text-[11px] font-mono ${
                    opts().scale === 1 ? 'sc-btn-primary is-active' : 'sc-btn-ghost'
                  }`}
                  data-testid="axis-screenshot-scale-1"
                  onClick={() => patch({ scale: 1 })}
                >
                  1×
                </button>
                <button
                  type="button"
                  class={`sc-btn py-1 px-2 text-[11px] font-mono ${
                    opts().scale === 2 ? 'sc-btn-primary is-active' : 'sc-btn-ghost'
                  }`}
                  data-testid="axis-screenshot-scale-2"
                  onClick={() => patch({ scale: 2 })}
                >
                  2×
                </button>
              </div>
            </div>

            <div class="flex gap-1 pt-0.5">
              <button
                type="button"
                class="sc-btn sc-btn-ghost flex-1 text-[11px]"
                data-testid="axis-screenshot-copy"
                disabled={busy()}
                onClick={() => void run('copy')}
              >
                <Icons.copy size={12} />
                Copy
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-primary flex-1 text-[11px]"
                data-testid="axis-screenshot-download"
                disabled={busy()}
                onClick={() => void run('download')}
              >
                <Icons.download size={12} />
                {busy() ? 'Saving…' : 'Download'}
              </button>
            </div>
      </Popover>
    </div>
  );
};

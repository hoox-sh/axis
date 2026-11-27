/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onCleanup, onMount } from 'solid-js';
import { clearToasts, notify } from '../store';
import { Toasts } from '../ui/Toasts';
import '../ui/motion.css';
const meta: Meta = { title: 'Chrome/Toasts', tags: ['autodocs'] };
export default meta;
function seed() {
  onMount(() => {
    notify('ok', 'Backtest complete · 128 trades', 'strategy');
    notify('warn', 'Rate limit approaching on Binance', 'datafeed');
    notify('error', 'PYNE run failed: line 42', 'engine');
  });
  onCleanup(() => clearToasts());
}
/** One toast per level (ok / warn / error), pinned bottom-right. */
export const Levels: StoryObj = {
  render: () => {
    seed();
    return (
      <div style={{ height: '220px', width: 'min(100%, 1440px)' }}>
        <p style={{ 'font-size': '12px', opacity: 0.6, 'max-width': '22rem' }}>
          Toasts pin bottom-right, 22rem wide from 390px through ultra-wide. Hover pauses
          auto-dismiss. Enter is a 6px rise; dismiss fades out before the card unmounts.
        </p>
        <button type="button" class="sc-btn" onClick={() => notify('ok', 'Saved', 'studio')}>
          Raise toast
        </button>
        <Toasts />
      </div>
    );
  },
};

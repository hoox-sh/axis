/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onCleanup, onMount } from 'solid-js';
import { clearToasts, notify } from '../store';
import { Toasts } from '../ui/Toasts';
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
export const Levels: StoryObj = {
  render: () => {
    seed();
    return (
      <div style={{ height: '220px' }}>
        <p style={{ 'font-size': '12px', opacity: 0.6 }}>Toasts pin bottom-right; hover pauses auto-dismiss.</p>
        <Toasts />
      </div>
    );
  },
};

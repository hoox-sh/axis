/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onCleanup, onMount } from 'solid-js';
import { appendLog, clearLogs } from '../store';
import { SystemLogs } from '../ui/SystemLogs';
const meta: Meta = { title: 'Panels/SystemLogs', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;
export const Seeded: StoryObj = {
  render: () => {
    onMount(() => {
      appendLog('ok', 'PYNE Pro connected', 'engine');
      appendLog('warn', 'Cache miss: 1h klines BTCUSDT', 'datafeed');
      appendLog('error', 'WS reconnect attempt 2', 'stream');
    });
    onCleanup(() => clearLogs());
    return (<div style={{ width: '640px', 'max-width': '94vw' }}><SystemLogs /></div>);
  },
};
export const Empty: StoryObj = {
  render: () => (<div style={{ width: '640px', 'max-width': '94vw' }}><SystemLogs /></div>),
};

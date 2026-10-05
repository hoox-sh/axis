/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { For } from 'solid-js';
import { Icons } from '../ui/icons';

const meta: Meta = { title: 'Chrome/Icons', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

const KEYS = [
  'play', 'settings', 'watchlist', 'search', 'save', 'menu', 'refresh', 'copy',
  'check', 'x', 'database', 'radio', 'plus', 'trash', 'eye', 'eyeOff', 'lock',
  'unlock', 'palette', 'zap', 'clock', 'alerts', 'results', 'studio', 'activity',
  'trend', 'layers', 'onchain', 'cpu', 'server',
] as const;

export const Gallery: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '8px', 'grid-template-columns': 'repeat(auto-fill,minmax(120px,1fr))', width: '720px', 'max-width': '92vw' }}>
      <For each={KEYS}>
        {(k) => {
          const I = (Icons as Record<string, typeof Icons.play>)[k];
          return I ? (
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '8px', border: '1px solid var(--color-border)', 'border-radius': '6px', background: 'var(--color-bg-panel)', 'font-size': '11px' }}>
              <I />
              <code style={{ opacity: 0.7 }}>{k}</code>
            </div>
          ) : null;
        }}
      </For>
    </div>
  ),
};

export const Sizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '16px' }}>
      <Icons.play size={12} />
      <Icons.play size={16} />
      <Icons.play size={24} />
      <Icons.play size={32} />
    </div>
  ),
};

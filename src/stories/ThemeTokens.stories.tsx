/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { For } from 'solid-js';

const TOKENS: Array<{ name: string; cssVar: string; swatch: string }> = [
  { name: 'void / bg-base', cssVar: '--color-bg-base', swatch: '#07080C' },
  { name: 'bg-panel', cssVar: '--color-bg-panel', swatch: '#0C0E14' },
  { name: 'bg-elev', cssVar: '--color-bg-elev', swatch: '#10131B' },
  { name: 'border', cssVar: '--color-border', swatch: '#1C2230' },
  { name: 'text', cssVar: '--color-text', swatch: '#E8EAEE' },
  { name: 'text-dim', cssVar: '--color-text-dim', swatch: '#9AA3B2' },
  { name: 'accent (periwinkle)', cssVar: '--color-accent', swatch: '#8B9CFF' },
  { name: 'live / green', cssVar: '--color-accent-2', swatch: '#3DDC97' },
  { name: 'warn / orange', cssVar: '--color-accent-3', swatch: '#E8B84A' },
  { name: 'danger / red', cssVar: '--color-red', swatch: '#F07178' },
];

const meta: Meta = {
  title: 'Theme/VOID tokens',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;

export const Palette: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '8px', 'grid-template-columns': 'repeat(auto-fill,minmax(180px,1fr))', width: '640px', 'max-width': '90vw' }}>
      <For each={TOKENS}>
        {(t) => (
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              padding: '8px',
              border: '1px solid var(--color-border)',
              'border-radius': '6px',
              background: 'var(--color-bg-panel)',
            }}
          >
            <span style={{ width: '24px', height: '24px', 'border-radius': '4px', background: t.swatch, border: '1px solid var(--color-border)' }} />
            <span style={{ display: 'flex', 'flex-direction': 'column', 'font-size': '11px' }}>
              <strong>{t.name}</strong>
              <code style={{ opacity: 0.6 }}>{t.cssVar}</code>
            </span>
          </div>
        )}
      </For>
    </div>
  ),
};

export const Buttons: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
      <button class="sc-btn sc-btn-primary" type="button">Primary</button>
      <button class="sc-btn" type="button">Default</button>
      <button class="sc-btn sc-btn-ghost" type="button">Ghost</button>
      <button class="sc-btn" type="button" disabled>Disabled</button>
    </div>
  ),
};

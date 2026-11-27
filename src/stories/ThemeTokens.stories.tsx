/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { For } from 'solid-js';

const GROUPS: Array<{ title: string; vars: Array<{ name: string; cssVar: string }> }> = [
  {
    title: 'Surfaces',
    vars: [
      { name: 'void / bg-base', cssVar: '--color-bg-base' },
      { name: 'bg-panel', cssVar: '--color-bg-panel' },
      { name: 'bg-elev', cssVar: '--color-bg-elev' },
      { name: 'border', cssVar: '--color-border' },
      { name: 'text', cssVar: '--color-text' },
      { name: 'text-dim', cssVar: '--color-text-dim' },
    ],
  },
  {
    title: 'Market and status',
    vars: [
      { name: 'up', cssVar: '--color-up' },
      { name: 'down', cssVar: '--color-down' },
      { name: 'warning', cssVar: '--color-warning' },
      { name: 'info', cssVar: '--color-info' },
      { name: 'alert fired', cssVar: '--color-alert-fired' },
      { name: 'alert armed', cssVar: '--color-alert-armed' },
    ],
  },
  {
    title: 'Series',
    vars: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `series ${n}`, cssVar: `--color-series-${n}` })),
  },
];

const meta: Meta = {
  title: 'Theme/VOID tokens',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;

/** VOID token swatches. Swatches read the live custom properties. */
export const Palette: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--ui-gap-lg, 16px)', 'max-width': '720px' }}>
      <For each={GROUPS}>
        {(group) => (
          <section style={{ display: 'grid', gap: 'var(--ui-gap-xs, 4px)' }}>
            <h3
              style={{
                margin: '0',
                'font-size': 'var(--ui-label, 11px)',
                'letter-spacing': '0.04em',
                'text-transform': 'uppercase',
                color: 'var(--color-text-dim)',
              }}
            >
              {group.title}
            </h3>
            <div
              style={{
                display: 'grid',
                gap: 'var(--ui-gap-xs, 4px)',
                'grid-template-columns': 'repeat(auto-fill, minmax(180px, 1fr))',
              }}
            >
              <For each={group.vars}>
                {(t) => (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: 'var(--ui-gap-xs, 8px)',
                      padding: 'var(--ui-pad-y, 4px) var(--ui-pad-x, 8px)',
                      border: '1px solid var(--color-border)',
                      'border-radius': 'var(--radius-panel)',
                      background: 'var(--color-bg-panel)',
                    }}
                  >
                    <span
                      style={{
                        width: 'var(--ui-space-16, 16px)',
                        height: 'var(--ui-space-16, 16px)',
                        'border-radius': 'var(--radius-input)',
                        background: `var(${t.cssVar})`,
                        border: '1px solid var(--color-border)',
                        'flex-shrink': '0',
                      }}
                    />
                    <span
                      style={{ display: 'flex', 'flex-direction': 'column', 'font-size': '11px' }}
                    >
                      <strong>{t.name}</strong>
                      <code style={{ opacity: 'var(--ui-opacity-muted, 0.64)' }}>{t.cssVar}</code>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          'grid-template-columns': 'auto minmax(0, 1fr) auto',
          gap: 'var(--ui-gap-xs, 4px) var(--ui-gap, 8px)',
          'font-family': 'var(--font-figure, var(--font-sans))',
          'font-variant-numeric': 'var(--ui-figure-variant, tabular-nums lining-nums)',
        }}
      >
        <span style={{ 'font-size': 'var(--ui-type-time)', color: 'var(--color-text-dim)' }}>
          09:41:02
        </span>
        <span
          style={{
            'font-size': 'var(--ui-type-price)',
            'font-weight': 'var(--ui-type-price-weight, 600)',
            'text-align': 'right',
          }}
        >
          67,432.50
        </span>
        <span style={{ 'font-size': 'var(--ui-type-price)', color: 'var(--color-up)' }}>
          +128.40
        </span>
        <span style={{ 'font-size': 'var(--ui-type-time)', color: 'var(--color-text-dim)' }}>
          09:41:08
        </span>
        <span style={{ 'font-size': 'var(--ui-type-price)', 'text-align': 'right' }}>
          67,304.10
        </span>
        <span style={{ 'font-size': 'var(--ui-type-price)', color: 'var(--color-down)' }}>
          −128.40
        </span>
        <span
          style={{
            'grid-column': '1 / -1',
            'font-size': 'var(--ui-type-volume)',
            color: 'var(--color-text-dim)',
          }}
        >
          Vol 1,284.50
        </span>
      </div>
    </div>
  ),
};

/** `sc-btn` variants rendered against the token palette. */
export const Buttons: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
      <button class="sc-btn sc-btn-primary" type="button">
        Primary
      </button>
      <button class="sc-btn" type="button">
        Default
      </button>
      <button class="sc-btn sc-btn-ghost" type="button">
        Ghost
      </button>
      <button class="sc-btn" type="button" disabled>
        Disabled
      </button>
    </div>
  ),
};

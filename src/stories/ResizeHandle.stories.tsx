/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { ResizeHandle } from '../ui/ResizeHandle';
const meta: Meta = { title: 'Chrome/ResizeHandle', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;
function PanelDemo(props: { direction: 'grow-right' | 'grow-down'; start: number }) {
  const [size, setSize] = createSignal(props.start);
  const horizontal = () => props.direction === 'grow-right';
  return (
    <div style={{ display: 'flex', gap: '0', 'align-items': 'stretch', height: horizontal() ? '120px' : 'auto', 'flex-direction': horizontal() ? 'row' : 'column' }}>
      <div style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', 'border-radius': '6px', padding: '8px', 'font-size': '11px', width: horizontal() ? `${size()}px` : '240px', height: horizontal() ? 'auto' : `${size()}px` }}>
        {size()}px — drag the grip
      </div>
      <ResizeHandle direction={props.direction} getSize={size} setSize={setSize} min={80} max={400} />
    </div>
  );
}
export const GrowRight: StoryObj = { render: () => <PanelDemo direction="grow-right" start={180} /> };
export const GrowDown: StoryObj = { render: () => <PanelDemo direction="grow-down" start={96} /> };

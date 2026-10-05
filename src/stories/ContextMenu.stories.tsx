/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuEntry } from '../ui/context-menu';
const meta: Meta = { title: 'Chrome/ContextMenu', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;
const ITEMS: ContextMenuEntry[] = [
  { type: 'item', id: 'run', label: 'Run script' },
  { type: 'item', id: 'rerun', label: 'Re-run on bar close', checked: true },
  { type: 'sep', id: 's1' },
  { type: 'item', id: 'duplicate', label: 'Duplicate pane' },
  { type: 'item', id: 'remove', label: 'Remove', danger: true },
  { type: 'item', id: 'disabled', label: 'Export (no data)', disabled: true },
];
export const ChartMenu: StoryObj = {
  render: () => (
    <div style={{ position: 'relative', width: '320px', height: '260px', border: '1px dashed var(--color-border)', 'border-radius': '6px' }}>
      <ContextMenu x={24} y={24} label="Chart" items={ITEMS} onClose={() => {}} onSelect={() => {}} />
    </div>
  ),
};

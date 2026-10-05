/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ToolCaret, ToolRailButton } from '../chart/drawings/toolbar/tool-button';
import { Icons } from '../ui/icons';

const meta: Meta = { title: 'Chart/DrawTools', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

export const RailButtons: StoryObj = {
  render: () => (
    <div class="axis-draw-rail" style={{ width: '44px' }}>
      <ToolRailButton title="Cursor" label="Cursor" active onSelect={() => {}}>
        <Icons.cursor />
      </ToolRailButton>
      <ToolRailButton title="Trend line" label="Trend line" onSelect={() => {}}>
        <Icons.trend />
      </ToolRailButton>
      <ToolRailButton title="Rectangle" label="Rectangle" pressed onSelect={() => {}}>
        <Icons.square />
      </ToolRailButton>
      <ToolRailButton title="Locked" label="Locked" disabled onSelect={() => {}}>
        <Icons.lock />
      </ToolRailButton>
      <ToolCaret label="More tools" title="More tools" expanded={false} onToggle={() => {}} />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <ToolRailButton title="Default" label="Default" onSelect={() => {}}>
        <Icons.pencil />
      </ToolRailButton>
      <ToolRailButton title="Active" label="Active" active onSelect={() => {}}>
        <Icons.pencil />
      </ToolRailButton>
      <ToolRailButton title="Pressed" label="Pressed" pressed onSelect={() => {}}>
        <Icons.pencil />
      </ToolRailButton>
    </div>
  ),
};

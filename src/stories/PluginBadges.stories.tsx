/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { CapabilityBadges } from '../ui/plugin-badges';

const meta: Meta = { title: 'Plugins/Badges', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

export const BuiltIn: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
      <CapabilityBadges kind="source" builtIn active capabilities={{ needsNetwork: true }} />
      <CapabilityBadges kind="engine" builtIn capabilities={{}} />
      <CapabilityBadges kind="stream" builtIn={false} active capabilities={{ needsAuth: true, needsProxy: true }} />
    </div>
  ),
};

export const Compact: StoryObj = {
  render: () => (
    <CapabilityBadges kind="source" builtIn active compact capabilities={{ needsNetwork: true }} />
  ),
};

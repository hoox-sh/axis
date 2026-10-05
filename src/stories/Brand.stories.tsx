/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { HooxLogo } from '../ui/HooxLogo';
import { HooxLoader } from '../ui/HooxLoader';

const meta: Meta = { title: 'Brand/HOOX', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

export const LogoSizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '16px', color: 'var(--color-text)' }}>
      <HooxLogo size="xs" />
      <HooxLogo size="m" />
      <HooxLogo size="l" />
    </div>
  ),
};

export const Loader: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
      <HooxLoader size="m" layout="icon" />
      <HooxLoader size="m" label="Loading workspace…" layout="inline" />
      <HooxLoader size="l" label="Booting AXIS" layout="stack" />
    </div>
  ),
};

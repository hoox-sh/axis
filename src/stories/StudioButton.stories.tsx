/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { StudioButton } from '../ui/studio/StudioButton';

const meta: Meta<typeof StudioButton> = {
  title: 'Studio/Button',
  component: StudioButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Primary / ghost / danger variants. Ghost is the secondary voice, not an invisible one: a visible hairline edge plus a quiet tint at rest, hover brightens the edge and lifts the box 1px, press sinks it back. Primary keeps the solid accent fill so the CTA still owns the view.',
      },
    },
  },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'ghost', 'danger'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: 'primary', children: 'Save theme' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Cancel' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Delete' },
};

export const Disabled: Story = {
  args: { variant: 'primary', disabled: true, children: 'Applied' },
};

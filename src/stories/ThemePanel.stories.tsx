/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Default store state — preset grid + token editor over the built-in
 * void-dark theme. No seeding needed.
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ThemePanel } from '../ui/ThemePanel';
const meta: Meta = { title: 'Panels/Theme', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;
export const Defaults: StoryObj = {
  render: () => (<div style={{ width: '560px', 'max-width': '92vw' }}><ThemePanel /></div>),
};
export const Compact: StoryObj = {
  render: () => (<div style={{ width: '480px', 'max-width': '92vw' }}><ThemePanel compact /></div>),
};

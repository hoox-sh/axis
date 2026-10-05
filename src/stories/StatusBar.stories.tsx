/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Empty store state — capsules render dashes/offline until a session seeds
 * symbols, engine status, and connection health.
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { StatusBar } from '../ui/StatusBar';
const meta: Meta = { title: 'Chrome/StatusBar', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;
export const EmptyState: StoryObj = {
  render: () => (<div style={{ width: '760px', 'max-width': '94vw' }}><StatusBar /></div>),
};

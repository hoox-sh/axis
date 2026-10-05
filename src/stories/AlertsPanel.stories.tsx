/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Default store state — empty alert list + creation form. Seeded variants
 * need indicatorSeries/runResults fixtures (phase 2).
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { AlertsPanel } from '../ui/AlertsPanel';
const meta: Meta = { title: 'Panels/Alerts', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;
export const Empty: StoryObj = {
  render: () => (<div style={{ width: '480px', 'max-width': '92vw' }}><AlertsPanel /></div>),
};

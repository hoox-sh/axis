/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { StudioJson } from '../ui/studio/StudioJson';
import { AppPageHeader } from '../ui/studio/AppPageHeader';
import { STUDIO_PAGE_BY_ID } from '../ui/studio/pages';
const meta: Meta = {
  title: 'Studio/Json+Header',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;
/** Pretty-printed JSON viewer for a sample run payload. */
export const Json: StoryObj = {
  render: () => (
    <div style={{ width: '480px', 'max-width': '90vw' }}>
      <StudioJson
        value={{
          symbol: 'BTCUSDT',
          interval: '1h',
          plots: [{ name: 'RSI', value: 54.2 }],
          ok: true,
        }}
      />
    </div>
  ),
};
/** Studio page header (settings page meta) with a close action. */
export const Header: StoryObj = {
  render: () => (
    <div style={{ width: '560px', 'max-width': '92vw' }}>
      <AppPageHeader meta={STUDIO_PAGE_BY_ID.settings} onClose={() => {}} />
    </div>
  ),
};

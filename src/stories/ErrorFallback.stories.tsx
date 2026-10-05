/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ErrorFallback } from '../ui/ErrorFallback';

const meta: Meta = { title: 'Chrome/ErrorFallback', tags: ['autodocs'] };
export default meta;

export const Page: StoryObj = {
  render: () => (
    <div style={{ width: '480px', 'max-width': '90vw' }}>
      <ErrorFallback error={new Error('WebGL context lost')} variant="page" source="chart" />
    </div>
  ),
};

export const Inline: StoryObj = {
  render: () => (
    <div style={{ width: '360px' }}>
      <ErrorFallback error="Failed to fetch klines" variant="inline" source="datafeed" />
    </div>
  ),
};

/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ErrorFallback } from '../ui/ErrorFallback';
import '../ui/motion.css';

const meta: Meta = { title: 'Chrome/ErrorFallback', tags: ['autodocs'] };
export default meta;

/** Full-page fallback for an Error instance (e.g. lost WebGL context). */
export const Page: StoryObj = {
  render: () => (
    <div style={{ width: '480px', 'max-width': '90vw' }}>
      <ErrorFallback error={new Error('WebGL context lost')} variant="page" source="chart" />
    </div>
  ),
};

/** Inline fallback for a plain message string inside a panel. */
export const Inline: StoryObj = {
  render: () => (
    <div style={{ width: '360px', height: '280px', display: 'flex' }}>
      <ErrorFallback error="Failed to fetch klines" variant="inline" source="datafeed" />
    </div>
  ),
};

/** 390px phone width — actions wrap, copy stays inside the pane. */
export const Narrow: StoryObj = {
  render: () => (
    <div style={{ width: '390px', height: '320px', display: 'flex' }}>
      <ErrorFallback
        error="Failed to fetch klines: network unreachable while the workspace was still open"
        variant="inline"
        source="datafeed"
        reset={() => undefined}
      />
    </div>
  ),
};

/** 1440px desk — the message stays in a column, it does not stretch. */
export const Desk: StoryObj = {
  render: () => (
    <div style={{ width: '1440px', 'max-width': '100%', height: '360px', display: 'flex' }}>
      <ErrorFallback
        error="WebGL context lost"
        variant="inline"
        source="chart"
        reset={() => undefined}
      />
    </div>
  ),
};

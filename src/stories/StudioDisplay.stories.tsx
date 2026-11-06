/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  StudioCard,
  StudioChip,
  StudioEmpty,
  StudioStat,
  StudioStatus,
} from '../ui/studio/StudioDisplay';

const meta: Meta = {
  title: 'Studio/Display',
  tags: ['autodocs'],
};

export default meta;

/** Chart-theme card with kicker, plus a selectable card for master-detail grids. */
export const Card: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', width: '320px' }}>
      <StudioCard kicker="Bars · Void" title="Void Dark">
        <p style={{ margin: '8px 0 0', opacity: 0.7, 'font-size': '12px' }}>
          Chart theme card with kicker + title.
        </p>
      </StudioCard>
      <StudioCard title="Selected" selected onClick={() => {}}>
        Selectable card (master-detail grid).
      </StudioCard>
    </div>
  ),
};

/** Label/value stat pairs. */
export const Stats: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px' }}>
      <StudioStat label="Symbols" value="12" />
      <StudioStat label="Engine" value="PYNE Pro" />
    </div>
  ),
};

/** Chips with one pressed (selected) state. */
export const Chips: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <StudioChip>1m</StudioChip>
      <StudioChip pressed>1h</StudioChip>
      <StudioChip>1D</StudioChip>
    </div>
  ),
};

/** Every health status: healthy, degraded, down, idle, unknown. */
export const Statuses: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
      <StudioStatus status="healthy" />
      <StudioStatus status="degraded" />
      <StudioStatus status="down" />
      <StudioStatus status="idle" />
      <StudioStatus status="unknown" />
    </div>
  ),
};

/** Empty-state placeholder with its message. */
export const Empty: StoryObj = {
  render: () => <StudioEmpty>No saved themes yet.</StudioEmpty>,
};

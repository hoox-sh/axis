/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { StudioColorInput } from '../ui/studio/StudioColorInput';
import { StudioField, StudioHint, StudioInput, StudioSelect, StudioToggle } from '../ui/studio/StudioField';

const meta: Meta = { title: 'Studio/Field', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

export const Input: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', width: '320px' }}>
      <StudioField label="Theme name" hint="A matching name replaces that theme.">
        <StudioInput placeholder="Theme name" value="Void Dark" />
      </StudioField>
      <StudioField label="Symbol" error="Enter a symbol.">
        <StudioInput mono placeholder="BTCUSDT" value="" />
      </StudioField>
      <StudioField label="Disabled">
        <StudioInput disabled value="locked" />
      </StudioField>
    </div>
  ),
};

export const Select: StoryObj = {
  render: () => (
    <div style={{ width: '320px' }}>
      <StudioField label="Interval">
        <StudioSelect value="1h">
          <option value="1m">1 minute</option>
          <option value="1h">1 hour</option>
          <option value="1D">1 day</option>
        </StudioSelect>
      </StudioField>
    </div>
  ),
};

export const Toggle: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', width: '320px' }}>
      <StudioToggle checked label="Live re-run" hint="Re-run on every tick." onChange={() => {}} />
      <StudioToggle checked={false} label="Notifications" onChange={() => {}} />
      <StudioToggle checked disabled label="Locked" onChange={() => {}} />
    </div>
  ),
};

export const Hint: StoryObj = {
  render: () => <StudioHint>Saving or using a palette stores it in that theme.</StudioHint>,
};

export const Color: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', width: '320px' }}>
      <StudioColorInput value="#8B9CFF" onChange={() => {}} />
      <StudioColorInput value="color.red" onChange={() => {}} />
      <StudioColorInput value="rgb(61, 220, 151)" onChange={() => {}} />
    </div>
  ),
};

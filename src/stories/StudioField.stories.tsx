/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { StudioColorInput } from '../ui/studio/StudioColorInput';
import {
  StudioField,
  StudioHint,
  StudioInput,
  StudioSelect,
  StudioToggle,
} from '../ui/studio/StudioField';

const meta: Meta = { title: 'Studio/Field', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

export const Input: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', width: '320px' }}>
      <StudioField label="Theme name" hint="A matching name replaces that theme.">
        <StudioInput placeholder="Theme name" value="Void Dark" />
      </StudioField>
      <StudioField label="Symbol" error="Enter a symbol.">
        <StudioInput mono invalid placeholder="BTCUSDT" value="" />
      </StudioField>
      <StudioField label="Disabled">
        <StudioInput disabled value="locked" />
      </StudioField>
    </div>
  ),
};

export const Invalid: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', width: '320px' }}>
      <StudioField label="Worker URL" error="URL must start with https://">
        <StudioInput mono invalid value="worker.local" />
      </StudioField>
      <StudioField label="Interval" error="Pick a listed interval.">
        <StudioSelect invalid value="">
          <option value="" disabled>
            Select…
          </option>
          <option value="1m">1 minute</option>
          <option value="1h">1 hour</option>
        </StudioSelect>
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

function ToggleDemo() {
  const [live, setLive] = createSignal(true);
  const [notes, setNotes] = createSignal(false);
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', width: '360px' }}>
      <StudioToggle
        checked={live()}
        label="Live re-run"
        hint="Re-run on every tick. Click to toggle."
        onChange={setLive}
      />
      <StudioToggle
        checked={notes()}
        label="Notifications"
        hint="Toast flood control stays in the Notifications tab."
        onChange={setNotes}
      />
      <StudioToggle checked disabled label="Locked" hint="Disabled switch stays dimmed." onChange={() => {}} />
    </div>
  );
}

export const Toggle: StoryObj = { render: () => <ToggleDemo /> };

export const SwitchGrid: StoryObj = {
  name: 'Switch grid',
  render: () => {
    const [brand, setBrand] = createSignal(true);
    const [market, setMarket] = createSignal(true);
    const [data, setData] = createSignal(false);
    const [layout, setLayout] = createSignal(true);
    return (
      <div class="ax-toggle-grid" style={{ width: '420px' }}>
        <StudioToggle checked={brand()} label="Brand" hint="AXIS wordmark." onChange={setBrand} />
        <StudioToggle
          checked={market()}
          label="Market"
          hint="Symbol, interval, chart type."
          onChange={setMarket}
        />
        <StudioToggle checked={data()} label="Data" hint="Venue and Load." onChange={setData} />
        <StudioToggle
          checked={layout()}
          label="Layout"
          hint="Chart layout menu."
          onChange={setLayout}
        />
      </div>
    );
  },
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

/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { StudioTabs } from '../ui/studio/StudioTabs';
import { StudioSection } from '../ui/studio/StudioSection';
import { StudioFooter } from '../ui/studio/StudioFooter';
import { StudioButton } from '../ui/studio/StudioButton';

const meta: Meta = { title: 'Studio/Page', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

function TabsDemo() {
  const [tab, setTab] = createSignal<'general' | 'keyboard' | 'data'>('general');
  return (
    <StudioTabs
      tabs={[
        { id: 'general', label: 'General' },
        { id: 'keyboard', label: 'Keyboard' },
        { id: 'data', label: 'Data' },
      ]}
      value={tab()}
      onChange={setTab}
      ariaLabel="Demo tabs"
      idPrefix="demo"
    />
  );
}

export const Tabs: StoryObj = { render: () => <TabsDemo /> };

export const Section: StoryObj = {
  render: () => (
    <div style={{ width: '480px', 'max-width': '90vw' }}>
      <StudioSection title="Notifications" lead="Flood control for toasts and system logs.">
        <p style={{ 'font-size': '12px', opacity: 0.7 }}>Section body content goes here.</p>
      </StudioSection>
      <StudioSection title="No lead">
        <p style={{ 'font-size': '12px', opacity: 0.7 }}>Section without lead copy.</p>
      </StudioSection>
    </div>
  ),
};

export const Footer: StoryObj = {
  render: () => (
    <div style={{ width: '480px', 'max-width': '90vw' }}>
      <StudioFooter status="3 unsaved changes">
        <StudioButton variant="ghost">Reset</StudioButton>
        <StudioButton variant="primary">Save</StudioButton>
      </StudioFooter>
    </div>
  ),
};

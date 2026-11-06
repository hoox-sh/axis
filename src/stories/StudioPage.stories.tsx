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
import { AppButton } from '../ui/studio/AppButton';
import { useMicrofeedback } from '../ui/studio/useMicrofeedback';
import { StudioStatus } from '../ui/studio/StudioDisplay';

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

/** Three-tab strip with a controlled selection and per-tab ids. */
export const Tabs: StoryObj = { render: () => <TabsDemo /> };

/** Section header variants: lead copy, header-end status, header-end action, no lead. */
export const Section: StoryObj = {
  render: () => (
    <div
      style={{
        width: '480px',
        'max-width': '90vw',
        display: 'flex',
        'flex-direction': 'column',
        gap: '24px',
      }}
    >
      <StudioSection title="Notifications" lead="Flood control for toasts and system logs.">
        <p style={{ 'font-size': '12px', opacity: 0.7 }}>Section body content goes here.</p>
      </StudioSection>
      <StudioSection
        title="MCP"
        lead="Bridge status sits on the title row."
        headerEnd={<StudioStatus status="healthy" label="Bridge open" />}
      >
        <p style={{ 'font-size': '12px', opacity: 0.7 }}>Connect this tab to MCP.</p>
      </StudioSection>
      <StudioSection
        title="Worker"
        lead="Probe action on the title row."
        headerEnd={
          <AppButton design="soft" tone="ghost" size="sm">
            Test connection
          </AppButton>
        }
      >
        <p style={{ 'font-size': '12px', opacity: 0.7 }}>Worker URL and API key fields.</p>
      </StudioSection>
      <StudioSection title="No lead">
        <p style={{ 'font-size': '12px', opacity: 0.7 }}>Section without lead copy.</p>
      </StudioSection>
    </div>
  ),
};

function LoadingButtonsDemo() {
  const saveFb = useMicrofeedback();
  const flushFb = useMicrofeedback();
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return (
    <div style={{ display: 'flex', gap: '12px', 'flex-wrap': 'wrap', 'align-items': 'center' }}>
      <StudioButton variant="ghost">Studio ghost</StudioButton>
      <AppButton
        design="soft"
        tone="primary"
        size="sm"
        feedback={saveFb.state()}
        onClick={() => void saveFb.run(() => wait(900))}
      >
        Save
      </AppButton>
      <AppButton
        design="soft"
        tone="danger"
        size="sm"
        feedback={flushFb.state()}
        onClick={() =>
          void flushFb.run(() => wait(700).then(() => Promise.reject(new Error('demo'))))
        }
      >
        Flush
      </AppButton>
      <span style={{ 'font-size': '12px', opacity: 0.65 }}>
        {saveFb.state()} / {flushFb.state()}
      </span>
    </div>
  );
}

/** Async buttons driven by `useMicrofeedback`: success hold and failure states. */
export const Buttons: StoryObj = { render: () => <LoadingButtonsDemo /> };

/** Footer with status text plus cancel / saving actions. */
export const Footer: StoryObj = {
  render: () => {
    const saveFb = useMicrofeedback({ successHoldMs: 550 });
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    return (
      <div style={{ width: '480px', 'max-width': '90vw' }}>
        <StudioFooter status="AXIS · scale 100%">
          <AppButton design="soft" tone="ghost" size="sm">
            Cancel
          </AppButton>
          <AppButton
            design="soft"
            tone="primary"
            size="sm"
            feedback={saveFb.state()}
            onClick={() => void saveFb.run(() => wait(400))}
          >
            Save
          </AppButton>
        </StudioFooter>
      </div>
    );
  },
};

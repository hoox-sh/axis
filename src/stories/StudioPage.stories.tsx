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
import { HooxLogo } from '../ui/HooxLogo';
import '../ui/studio/studio.css';

const meta: Meta = { title: 'Studio/Page', tags: ['autodocs'], parameters: { layout: 'padded' } };
export default meta;

function TabsDemo() {
  const [tab, setTab] = createSignal<'general' | 'topbar' | 'keyboard' | 'data' | 'storage'>('general');
  return (
    <StudioTabs
      tabs={[
        { id: 'general', label: 'General', hint: 'Scale, chart, labels, live re-run.', group: 'workspace' },
        { id: 'topbar', label: 'Topbar', hint: 'Chrome groups and panel buttons.', group: 'workspace' },
        { id: 'keyboard', label: 'Keyboard', hint: 'Shortcut chords.', group: 'workspace' },
        { id: 'data', label: 'Data', hint: 'Exchange keys and datasets.', group: 'data' },
        { id: 'storage', label: 'Storage', hint: 'Script library and cloud Worker.', group: 'data' },
      ]}
      value={tab()}
      onChange={setTab}
      ariaLabel="Demo tabs"
      idPrefix="demo"
    />
  );
}

/** Grouped tab strip with separators and an active-tab caption. */
export const Tabs: StoryObj = { render: () => <TabsDemo /> };

/** Studio rail brand: HOOX mark plus AXIS studio wordmark. */
export const RailBrand: StoryObj = {
  render: () => (
    <div class="ax-page-rail" style={{ width: '13.5rem', height: '8rem' }}>
      <div class="ax-page-rail-brand" data-testid="axis-studio-brand">
        <HooxLogo size={22} class="ax-page-rail-logo" title="HOOX" />
        <span class="ax-page-rail-brand-copy">
          AXIS
          <span>studio</span>
        </span>
      </div>
    </div>
  ),
};

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

/** Wire three-column hierarchy: recipes, slot rail, plan. */
export const WireLayout: StoryObj = {
  render: () => (
    <div class="ax-page-body--flush" style={{ height: '22rem', width: 'min(64rem, 100%)' }}>
      <div class="ax-wire-body">
      <aside class="ax-wire-col ax-wire-col--presets">
        <div class="ax-wire-col-head">
          <h3 class="ax-section-title">Recipes</h3>
          <span class="ax-card-kicker">3</span>
        </div>
        <button type="button" class="ax-wire-preset is-base is-exact">
          <div class="ax-wire-preset-head">
            <span class="ax-wire-preset-name">Local compile</span>
            <span class="ax-status ax-status--healthy">active</span>
          </div>
          <p class="ax-wire-preset-tag">pyne on loopback, REST stream off.</p>
        </button>
      </aside>
      <div class="ax-wire-col ax-wire-col--rail">
        <ol class="ax-wire-rail">
          <li class="ax-wire-slot">
            <div class="ax-wire-spine">
              <span class="ax-wire-spine-node is-on">1</span>
            </div>
            <div class="ax-wire-slot-body">
              <h4 class="ax-label">Source</h4>
              <p class="ax-hint">Venue candles for the chart.</p>
            </div>
          </li>
        </ol>
      </div>
      <aside class="ax-wire-col ax-wire-col--plan">
        <div class="ax-wire-plan">
          <section class="ax-section ax-wire-block--tight">
            <h3 class="ax-section-title">Plan</h3>
            <p class="ax-hint">Exact match to Local compile.</p>
          </section>
        </div>
      </aside>
      </div>
    </div>
  ),
};

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

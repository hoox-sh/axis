/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Microfeedback concept — the "perfect" UI acknowledgement system.
 * Contact (press) → process (loading) → outcome (success/error) → ambient
 * (toast/status). Compositor-only, height-stable, reduced-motion safe.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { AppButton } from '../ui/studio/AppButton';
import { useMicrofeedback } from '../ui/studio/useMicrofeedback';
import type { ButtonDesign } from '../ui/studio/AppButton';

const meta: Meta = {
  title: 'Studio/Microfeedback',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Every tap gets acknowledged in under 50ms, every async action narrates itself, every outcome confirms or invites retry — then gets out of the way. Implemented in AppButton + useMicrofeedback + button-designs.css.',
      },
    },
  },
};

export default meta;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The concept, readable end to end: layers, timings, rules. */
export const Concept: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>Microfeedback — acknowledge · progress · confirm</h2>
        <p>
          The rule: <strong>no dead taps.</strong> A press answers instantly
          (contact), async work shows itself without moving layout (process),
          the result confirms or invites retry (outcome), and anything the user
          didn't ask to watch surfaces at the edge (ambient). All motion is
          transform/opacity only — the chart never janks.
        </p>
      </div>
      <div class="axd-grid3">
        <div class="axd-card">
          <p class="axd-kicker">1 · Contact · &lt;50ms</p>
          <h3>The tap answers</h3>
          <p class="axd-desc">
            Press scales to 0.97 in 60ms, a ripple dot blooms from the pointer,
            hover lifts Signal by −1px. Pure CSS <code>:active</code> — works
            before JS even wakes.
          </p>
          <div class="axd-row">
            <AppButton design="signal" tone="primary">Press me</AppButton>
            <AppButton design="soft" tone="ghost">Press me</AppButton>
            <AppButton design="term" tone="ghost">Press me</AppButton>
          </div>
        </div>
        <div class="axd-card">
          <p class="axd-kicker">2 · Process · height-stable</p>
          <h3>The work shows itself</h3>
          <p class="axd-desc">
            Spinner + label swap to “Working…”, <code>aria-busy</code> set, button
            keeps its size (no layout shift). Signal sweeps a light wash; Soft
            and Terminal slide a 2px hairline.
          </p>
          <div class="axd-row">
            <AppButton design="signal" tone="primary" feedback="loading">Save</AppButton>
            <AppButton design="soft" tone="primary" feedback="loading">Save</AppButton>
            <AppButton design="term" tone="primary" feedback="loading">Save</AppButton>
          </div>
        </div>
        <div class="axd-card">
          <p class="axd-kicker">3 · Outcome · then quiet</p>
          <h3>The result confirms</h3>
          <p class="axd-desc">
            Success morphs to a spring check for 900ms (“Done”); error shakes
            400ms and turns the edge red (“Retry”). Then idle — the button
            doesn't brag.
          </p>
          <div class="axd-row">
            <AppButton design="signal" tone="primary" feedback="success">Save</AppButton>
            <AppButton design="soft" tone="primary" feedback="error">Save</AppButton>
            <AppButton design="term" tone="danger" feedback="error">Delete</AppButton>
          </div>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">4 · Ambient · at the edge</p>
        <h3>The app remembers out loud</h3>
        <p class="axd-desc">
          The button handles its own tap; the <em>system</em> handles the news.
          Pair every outcome with a toast or status capsule so feedback survives
          after the button returns to idle. Live controls pulse a 6px dot.
        </p>
        <div class="axd-row">
          <AppButton design="term" tone="ghost" live liveOn>Live · ticking</AppButton>
          <AppButton design="term" tone="ghost" live>Live · idle</AppButton>
          <AppButton design="soft" tone="ghost" kbd="⌘K">Command</AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Shapes share it · same contract, any form</p>
        <p class="axd-desc">
          Pill, orb, cut, tab, and segmented cells run the identical contact →
          process → outcome loop. Orbs show the spinner alone; tabs keep the
          underline; the timing never changes.
        </p>
        <div class="axd-row">
          <AppButton design="soft" tone="primary" shape="pill" feedback="loading">Filter</AppButton>
          <AppButton design="signal" tone="primary" shape="orb" feedback="loading" ariaLabel="Running">▶</AppButton>
          <AppButton design="signal" tone="primary" shape="cut" feedback="success">Deploy</AppButton>
          <AppButton design="term" tone="ghost" shape="tab" feedback="error" active>Editor</AppButton>
        </div>
      </div>
      <div class="axd-note">
        <strong>Timing tokens</strong> — <code>--ax-fb-fast 120ms</code> press ·{' '}
        <code>--ax-fb-base 150ms</code> hover · <code>--ax-fb-release 200ms</code>{' '}
        spring back · <code>--ax-fb-load 1.1s</code> sweep loop ·{' '}
        <code>--ax-fb-success 900ms</code> hold · <code>--ax-fb-error 420ms</code>{' '}
        shake. Easing <code>cubic-bezier(0.2, 0.8, 0.2, 1)</code> everywhere.
      </div>
    </div>
  ),
};

/** Interactive playground: fire real async actions through the hook. */
export const Playground: StoryObj = {
  render: () => {
    const fbSave = useMicrofeedback();
    const fbDelete = useMicrofeedback();
    const [design, setDesign] = createSignal<ButtonDesign>('signal');
    const d = () => design();
    return (
      <div class="axd-demo">
        <div class="axd-demo-head">
          <h2>Playground — real promises, real feedback</h2>
          <p>
            Save resolves, delete rejects. The hook drives{' '}
            <code>loading → success / error → idle</code> automatically, swaps
            the label, and sets <code>aria-busy</code>. Switch the design voice
            mid-flight — timing stays identical.
          </p>
        </div>
        <div class="axd-card">
          <p class="axd-kicker">Design voice</p>
          <div class="axd-row">
            <AppButton design="term" tone={d() === 'soft' ? 'primary' : 'ghost'} onClick={() => { setDesign('soft'); }}>Soft</AppButton>
            <AppButton design="term" tone={d() === 'signal' ? 'primary' : 'ghost'} onClick={() => { setDesign('signal'); }}>Signal</AppButton>
            <AppButton design="term" tone={d() === 'term' ? 'primary' : 'ghost'} onClick={() => { setDesign('term'); }}>Term</AppButton>
          </div>
        </div>
        <div class="axd-card axd-card--elev">
          <p class="axd-kicker">Try it · state: {fbSave.state()} / {fbDelete.state()}</p>
          <div class="axd-row">
            <AppButton design={d()} tone="primary" feedback={fbSave.state()} onClick={() => fbSave.run(() => wait(1200))}>
              Save theme
            </AppButton>
            <AppButton design={d()} tone="danger" feedback={fbDelete.state()} onClick={() => fbDelete.run(() => wait(900).then(() => Promise.reject(new Error('demo'))))}>
              Delete list
            </AppButton>
            <AppButton design={d()} tone="ghost" kbd="⌘↵" feedback={fbSave.state()} onClick={() => fbSave.run(() => wait(1200))}>
              Quick run
            </AppButton>
          </div>
          <p class="axd-desc">
            Labels morph Working… → Done / Retry without changing width. Keyboard:
            Tab to focus (accent ring), Enter to fire. Screen readers hear the
            polite live region.
          </p>
        </div>
        <div class="axd-dos">
          <div class="axd-do">
            <strong>Do</strong>
            One feedback owner per action (the hook <em>or</em> the parent, never
            both). Hold success 900ms so the eye lands, then release to idle.
          </div>
          <div class="axd-dont">
            <strong>Don't</strong>
            Disable-then-vanish (the user wonders if the tap landed). Shake on
            success, glow on error, or stack a toast <em>and</em> a modal for one
            save.
          </div>
        </div>
      </div>
    );
  },
};

/** Implementation contract: snippet, a11y, reduced motion. */
export const Contract: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>Contract — build it like this</h2>
        <p>One hook, one button, zero layout shift. Copy the shape, keep the tokens.</p>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Shape</p>
        <table class="axd-spec">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>AppButton</td>
              <td>design × tone × size, ripple dot, spinner / check / shake, aria-busy + aria-live</td>
            </tr>
            <tr>
              <td>useMicrofeedback().run(fn)</td>
              <td>wraps a promise: loading → success 900ms / error shake → idle</td>
            </tr>
            <tr>
              <td>button-designs.css</td>
              <td>--ax-fb-* tokens, sweep + fill + pop + shake keyframes</td>
            </tr>
            <tr>
              <td>ambient</td>
              <td>toast / status capsule carries the news after idle</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Accessibility</p>
        <p class="axd-desc">
          Focus-visible gets a 3px accent halo (never outline:none alone). Loading
          sets <code>aria-busy=true</code> and keeps the label readable
          (“Working…”). Outcome text changes under <code>aria-live="polite"</code>.
          Disabled stays at 45% opacity with <code>not-allowed</code> — never
          rely on color alone; the check / shake / label all carry meaning.
        </p>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Reduced motion</p>
        <p class="axd-desc">
          <code>prefers-reduced-motion: reduce</code> kills the sweep, spin, shake,
          pop, ripple, and live pulse — state still changes (spinner becomes a
          static mark, shake becomes a plain red edge). Verify with your OS
          setting; the stories honor it live.
        </p>
        <div class="axd-row">
          <AppButton design="soft" tone="primary" feedback="loading">Save</AppButton>
          <AppButton design="soft" tone="primary" feedback="success">Save</AppButton>
          <AppButton design="soft" tone="danger" feedback="error">Delete</AppButton>
        </div>
      </div>
    </div>
  ),
};

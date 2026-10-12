/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Button designs showcase — three candidate app-button languages plus
 * non-rectangular forms (pill / orb / cut / tab) and segmented groups.
 * A: Void Soft (calm panel default) · B: Signal Solid (decisive CTA) ·
 * C: Terminal Hairline (dense trading-desk chrome).
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { AppButton } from '../ui/studio/AppButton';
import type { ButtonDesign } from '../ui/studio/AppButton';

const meta: Meta = {
  title: 'Studio/ButtonDesigns',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Three candidate button languages for AXIS, each in five forms: rect (classic), pill (chips), orb (circular icon), cut (chamfered CTA), tab (borderless underline). A keeps the calm panel voice, B carries the one decisive action per view, C speaks trading-desk mono. All share one microfeedback layer — see Studio/Microfeedback.',
      },
    },
  },
};

export default meta;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const demoSave = () => wait(1100);
const demoFail = () => wait(800).then(() => Promise.reject(new Error('demo')));

function DesignCard(props: {
  design: ButtonDesign;
  kicker: string;
  title: string;
  desc: string;
  useWhen: string;
}) {
  return (
    <div class="axd-card">
      <p class="axd-kicker">{props.kicker}</p>
      <h3>{props.title}</h3>
      <p class="axd-desc">{props.desc}</p>
      <div class="axd-stack">
        <AppButton design={props.design} tone="primary" onClick={demoSave}>
          Save theme
        </AppButton>
        <div class="axd-row">
          <AppButton design={props.design} tone="ghost" size="sm">
            Cancel
          </AppButton>
          <AppButton design={props.design} tone="danger" size="sm">
            Delete
          </AppButton>
          <AppButton design={props.design} tone="success" size="sm">
            Applied
          </AppButton>
        </div>
        <div class="axd-row">
          <AppButton design={props.design} tone="warning" size="sm">
            Rate limit
          </AppButton>
          <AppButton design={props.design} tone="primary" size="sm" kbd="⌘↵" onClick={demoSave}>
            Run
          </AppButton>
          <AppButton design={props.design} tone="ghost" feedback="loading">
            Ghost
          </AppButton>
          <AppButton design={props.design} tone="ghost" disabled>
            Off
          </AppButton>
        </div>
      </div>
      <p class="axd-desc">
        <strong style={{ color: 'var(--color-text)' }}>Use when — </strong>
        {props.useWhen}
      </p>
    </div>
  );
}

/** Side-by-side showcase of all three designs. Start here. */
export const Showcase: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>App buttons — three directions</h2>
        <p>
          Click any primary to feel the shared microfeedback: press ripple → loading
          (height-stable) → success check. Same timing on every design; only the
          voice changes. One decisive action per view gets design B. For
          non-rectangular forms, continue to Shapes.
        </p>
      </div>
      <div class="axd-grid3">
        <DesignCard
          design="soft"
          kicker="Design A · default"
          title="Void Soft"
          desc="Calm evolution of today's ax-btn. Tinted fills, 6px radius, soft ambient shadow on primary. Disappears into panels."
          useWhen="dialogs, settings, library rows, any secondary surface."
        />
        <DesignCard
          design="signal"
          kicker="Design B · one per view"
          title="Signal Solid"
          desc="Solid periwinkle, dark ink text, glow shadow, sweep fill while loading. Carries the single decisive action."
          useWhen="Run / Add / Save — the thing the view exists for."
        />
        <DesignCard
          design="term"
          kicker="Design C · dense chrome"
          title="Terminal Hairline"
          desc="11px mono uppercase, 2px radius, corner tick, inset underline when active. Speaks the engine-switch language."
          useWhen="topbar, toolbars, interval + engine clusters."
        />
      </div>
      <div class="axd-note">
        <strong>How to pick.</strong> Panels → A · the one action that matters → B ·
        dense rows of small controls → C. Never two B primaries in one view.
        Warning (amber) is for rate limits and reconnects — never for delete.
      </div>
    </div>
  ),
};

/** Non-rectangular forms: pill, orb, cut, tab. The shape matrix. */
export const Shapes: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>Shapes — beyond the rectangle</h2>
        <p>
          Shape is orthogonal to design: any tone and size renders in any form,
          and every form shares the same press → loading → success/error
          feedback. Pick the form by density and meaning, the design by voice.
        </p>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Pill · chips, intervals, filters</p>
        <h3>Soft capsule for swappable peers</h3>
        <p class="axd-desc">
          Fully rounded 999px. Peers of equal weight — timeframes, filter tokens,
          watchlist lists. Active pill fills with accent tint.
        </p>
        <div class="axd-row">
          <AppButton design="term" tone="ghost" shape="pill" size="xs">1m</AppButton>
          <AppButton design="term" tone="primary" shape="pill" size="xs" active>1h</AppButton>
          <AppButton design="term" tone="ghost" shape="pill" size="xs">1D</AppButton>
          <AppButton design="term" tone="ghost" shape="pill" size="xs">1W</AppButton>
        </div>
        <div class="axd-row">
          <AppButton design="soft" tone="ghost" shape="pill" size="sm">All symbols</AppButton>
          <AppButton design="soft" tone="primary" shape="pill" size="sm" active>Scalps</AppButton>
          <AppButton design="soft" tone="ghost" shape="pill" size="sm">Swings</AppButton>
          <AppButton design="soft" tone="warning" shape="pill" size="sm">Delayed</AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Orb · circular icon action</p>
        <h3>The disc for floating tools</h3>
        <p class="axd-desc">
          Perfect circle, icon only, no kbd hint. Chart-corner tools, detach,
          close, play. Signal orb glows; loading shows the spinner alone.
        </p>
        <div class="axd-dock">
          <AppButton design="signal" tone="primary" shape="orb" ariaLabel="Run" icon={<span>▶</span>} />
          <AppButton design="soft" tone="ghost" shape="orb" ariaLabel="Refresh" icon={<span>↻</span>} />
          <AppButton design="soft" tone="ghost" shape="orb" size="sm" ariaLabel="Add" icon={<span>+</span>} />
          <AppButton design="soft" tone="danger" shape="orb" size="sm" ariaLabel="Close" icon={<span>×</span>} />
          <AppButton design="signal" tone="primary" shape="orb" size="lg" ariaLabel="Live" live liveOn />
        </div>
        <div class="axd-row">
          <AppButton design="signal" tone="primary" shape="orb" feedback="loading" ariaLabel="Running" icon={<span>▶</span>} />
          <AppButton design="signal" tone="primary" shape="orb" feedback="success" ariaLabel="Done" icon={<span>▶</span>} />
          <AppButton design="soft" tone="ghost" shape="orb" disabled ariaLabel="Off" icon={<span>▶</span>} />
          <AppButton design="term" tone="primary" shape="orb" size="sm" active ariaLabel="Pinned" icon={<span>●</span>} />
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Cut · chamfered tech CTA</p>
        <h3>The blueprint corner for the decisive action</h3>
        <p class="axd-desc">
          Clipped top-right corner, square otherwise. Blueprint voice for Run /
          Add when the view wants an edge. Best as Signal primary or Terminal
          primary; ghost keeps an open-corner hairline.
        </p>
        <div class="axd-row">
          <AppButton design="signal" tone="primary" shape="cut" kbd="⌘↵" onClick={demoSave}>
            + Add to chart
          </AppButton>
          <AppButton design="term" tone="primary" shape="cut" size="sm">Deploy worker</AppButton>
        </div>
        <div class="axd-row">
          <AppButton design="soft" tone="ghost" shape="cut" size="sm">Preview</AppButton>
          <AppButton design="signal" tone="danger" shape="cut" size="sm" onClick={demoFail}>
            Delete script
          </AppButton>
          <AppButton design="signal" tone="success" shape="cut" size="sm">Deployed</AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Tab · borderless underline</p>
        <h3>Text with an inset rule for module bars</h3>
        <p class="axd-desc">
          No box at all — the 2px inset underline is the control. Active tab
          turns accent. For module switches, engine rows, view toggles where a
          box would shout.
        </p>
        <div class="axd-bar">
          <AppButton design="term" tone="ghost" shape="tab" active>Chart</AppButton>
          <AppButton design="term" tone="ghost" shape="tab">Editor</AppButton>
          <AppButton design="term" tone="ghost" shape="tab">Backtest</AppButton>
          <AppButton design="term" tone="danger" shape="tab">Alerts</AppButton>
        </div>
        <div class="axd-row">
          <AppButton design="soft" tone="ghost" shape="tab" size="sm" active>Overview</AppButton>
          <AppButton design="soft" tone="ghost" shape="tab" size="sm">Code</AppButton>
          <AppButton design="soft" tone="ghost" shape="tab" size="sm">Settings</AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Segmented · joined capsule</p>
        <h3>One hairline, many options</h3>
        <p class="axd-desc">
          Wrap peer buttons in <code>.axd-seg</code> (or <code>.axd-seg--pill</code>)
          — the container owns the border, dividers split the cells, the active
          cell tints. Engine switches and interval clusters live here.
        </p>
        <div class="axd-row">
          <span class="axd-seg axd-seg--pill">
            <AppButton design="term" tone="ghost" size="xs">1m</AppButton>
            <AppButton design="term" tone="ghost" size="xs" active>1h</AppButton>
            <AppButton design="term" tone="ghost" size="xs">1D</AppButton>
          </span>
          <span class="axd-seg">
            <AppButton design="term" tone="ghost" size="sm">Pro API</AppButton>
            <AppButton design="term" tone="ghost" size="sm" active>Worker</AppButton>
            <AppButton design="term" tone="ghost" size="sm">Pyodide</AppButton>
          </span>
        </div>
      </div>
      <div class="axd-dos">
        <div class="axd-do">
          <strong>Do</strong>
          Pill for peers, orb for icon-only floating tools, cut for at most one
          CTA per view, tab inside bars, seg for joined option rows.
        </div>
        <div class="axd-dont">
          <strong>Don't</strong>
          Cut for body copy buttons, orb with text labels, tabs outside a bar
          context, or three chamfered primaries competing in one dialog.
        </div>
      </div>
    </div>
  ),
};

/** Full tone × size matrix per design, incl. warning, xs, and pressed. */
export const Matrix: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>Tone × size matrix</h2>
        <p>Every design ships primary / ghost / danger / success / warning in xs / sm / md / lg plus icon-only, pressed, and disabled.</p>
      </div>
      {(['soft', 'signal', 'term'] as ButtonDesign[]).map((d) => (
        <div class="axd-card">
          <p class="axd-kicker">Design {d === 'soft' ? 'A · Void Soft' : d === 'signal' ? 'B · Signal Solid' : 'C · Terminal Hairline'}</p>
          <div class="axd-stack">
            <div class="axd-row">
              <AppButton design={d} tone="primary" size="xs">Primary xs</AppButton>
              <AppButton design={d} tone="primary" size="sm">Primary sm</AppButton>
              <AppButton design={d} tone="primary" size="md">Primary md</AppButton>
              <AppButton design={d} tone="primary" size="lg">Primary lg</AppButton>
              <AppButton design={d} tone="primary" size="icon" ariaLabel="Play">▶</AppButton>
            </div>
            <div class="axd-row">
              <AppButton design={d} tone="ghost" size="sm">Ghost</AppButton>
              <AppButton design={d} tone="danger" size="sm">Danger</AppButton>
              <AppButton design={d} tone="success" size="sm">Success</AppButton>
              <AppButton design={d} tone="warning" size="sm">Warning</AppButton>
            </div>
            <div class="axd-row">
              <AppButton design={d} tone="ghost" size="sm" active>Pressed</AppButton>
              <AppButton design={d} tone="primary" size="sm" active>Pressed</AppButton>
              <AppButton design={d} tone="primary" size="md" feedback="loading">Primary</AppButton>
              <AppButton design={d} tone="primary" size="md" feedback="success">Primary</AppButton>
              <AppButton design={d} tone="primary" size="md" feedback="error">Primary</AppButton>
              <AppButton design={d} tone="primary" size="md" disabled>Disabled</AppButton>
            </div>
            <div class="axd-row">
              <AppButton design={d} tone="primary" size="md" block>Block · full width</AppButton>
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
};

/** Buttons where they live: command bar, dialog footer, module tabs, chart dock. */
export const InContext: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>In context</h2>
        <p>Terminal pills up top, tabs for modules, Soft in the dialog, one Signal cut for the commit, orbs floating over the chart.</p>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Command bar · pill intervals + one Signal cut</p>
        <div class="axd-bar">
          <span class="axd-seg axd-seg--pill">
            <AppButton design="term" tone="ghost" size="xs">1m</AppButton>
            <AppButton design="term" tone="ghost" size="xs" active>1h</AppButton>
            <AppButton design="term" tone="ghost" size="xs">1D</AppButton>
          </span>
          <AppButton design="term" tone="ghost" shape="tab" active>Replay</AppButton>
          <span style={{ flex: 1 }} />
          <AppButton design="signal" tone="primary" shape="cut" size="sm" kbd="⌘↵" onClick={demoSave}>
            + Add
          </AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Module bar · tabs</p>
        <div class="axd-bar">
          <AppButton design="term" tone="ghost" shape="tab" active>Chart</AppButton>
          <AppButton design="term" tone="ghost" shape="tab">Editor</AppButton>
          <AppButton design="term" tone="ghost" shape="tab">Backtest</AppButton>
          <span style={{ flex: 1 }} />
          <AppButton design="term" tone="ghost" live liveOn>Live</AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Dialog footer · Soft + one Signal (block on narrow)</p>
        <p class="axd-desc">Rename watchlist “Scalps” — footer stays quiet so the commit carries weight.</p>
        <div class="axd-row" style={{ 'justify-content': 'flex-end' }}>
          <AppButton design="soft" tone="ghost">Cancel</AppButton>
          <AppButton design="soft" tone="danger" size="sm" onClick={demoFail}>
            Delete list
          </AppButton>
          <AppButton design="signal" tone="primary" onClick={demoSave}>
            Save changes
          </AppButton>
        </div>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Chart corner · orb dock</p>
        <div class="axd-dock">
          <AppButton design="signal" tone="primary" shape="orb" ariaLabel="Run" icon={<span>▶</span>} />
          <AppButton design="soft" tone="ghost" shape="orb" size="sm" ariaLabel="Add" icon={<span>+</span>} />
          <AppButton design="soft" tone="ghost" shape="orb" size="sm" ariaLabel="Reset" icon={<span>↻</span>} />
        </div>
        <p class="axd-desc">Discs float over canvas chrome; engine switch stays a joined seg.</p>
        <div class="axd-row">
          <span class="axd-seg">
            <AppButton design="term" tone="ghost" size="sm">Pro API</AppButton>
            <AppButton design="term" tone="ghost" size="sm" active>Worker</AppButton>
            <AppButton design="term" tone="ghost" size="sm">Pyodide</AppButton>
          </span>
        </div>
      </div>
    </div>
  ),
};

/** Spec sheet: anatomy, tokens, shapes, and when to use which. */
export const SpecSheet: StoryObj = {
  render: () => (
    <div class="axd-demo">
      <div class="axd-demo-head">
        <h2>Spec sheet</h2>
        <p>Hand this to whoever builds the button. Radii, type, shapes, and feedback tokens per design.</p>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Anatomy</p>
        <table class="axd-spec">
          <thead>
            <tr>
              <th>Token</th>
              <th>A · Void Soft</th>
              <th>B · Signal Solid</th>
              <th>C · Terminal Hairline</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>radius</td>
              <td>6px panel radius</td>
              <td>4px input radius</td>
              <td>2px chip radius</td>
            </tr>
            <tr>
              <td>type</td>
              <td>system 550, −0.01em</td>
              <td>system 650, glow shadow</td>
              <td>mono 11px, +0.09em, uppercase</td>
            </tr>
            <tr>
              <td>primary</td>
              <td>tinted fill, accent text</td>
              <td>solid accent, dark ink text</td>
              <td>tint 14% + inset underline</td>
            </tr>
            <tr>
              <td>warning</td>
              <td>amber tint 15%</td>
              <td>solid amber, dark text</td>
              <td>amber hairline</td>
            </tr>
            <tr>
              <td>loading</td>
              <td>spinner + hairline slide</td>
              <td>spinner + sweep wash</td>
              <td>spinner + hairline slide</td>
            </tr>
            <tr>
              <td>marker</td>
              <td>—</td>
              <td>hover lift −1px (boxes)</td>
              <td>corner tick (boxed only)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="axd-card">
        <p class="axd-kicker">Shapes</p>
        <table class="axd-spec">
          <thead>
            <tr>
              <th>Shape</th>
              <th>Form</th>
              <th>Use when</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>rect</td>
              <td>classic per-design radius</td>
              <td>default — dialogs, footers, forms</td>
            </tr>
            <tr>
              <td>pill</td>
              <td>999px capsule</td>
              <td>peer chips: intervals, filters, lists</td>
            </tr>
            <tr>
              <td>orb</td>
              <td>perfect circle, icon only</td>
              <td>floating chart tools, detach, close</td>
            </tr>
            <tr>
              <td>cut</td>
              <td>chamfered corner CTA</td>
              <td>one decisive action with an edge</td>
            </tr>
            <tr>
              <td>tab</td>
              <td>borderless + 2px underline</td>
              <td>module / engine bars</td>
            </tr>
            <tr>
              <td>.axd-seg</td>
              <td>joined capsule group</td>
              <td>option rows sharing one hairline</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="axd-dos">
        <div class="axd-do">
          <strong>Do</strong>
          One Signal primary per view. Terminal in rows of 3+ dense controls. Keep
          labels verb-led: Add, Save, Apply, Retry. xs for table rows, block for
          stacked mobile footers.
        </div>
        <div class="axd-dont">
          <strong>Don't</strong>
          Two glowing primaries side by side. Terminal for long sentences (it shouts).
          Signal for destructive — danger has its own solid red. Orbs with text.
        </div>
      </div>
    </div>
  ),
};

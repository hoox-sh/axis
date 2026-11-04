/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Studio/Inputs — the full input language: anatomy, states, smart actions,
 * validation, select, toggle, color, range, textarea, and keyboard contracts.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import { Icons } from '../ui/icons';
import {
  StudioColorInput,
  StudioField,
  StudioHint,
  StudioInput,
  StudioRange,
  StudioSelect,
  StudioTextarea,
  StudioToggle,
  StudioButton,
} from '../ui/studio';
import '../ui/studio/input-designs.css';

const meta: Meta = {
  title: 'Studio/Inputs',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The Studio input system. Every control answers four questions without a legend: what is it (label + icon), is it valid (edge, icon, message), what happens on Enter (kbd hint + action), and how do I undo it (clear, reveal, revert). Chrome carries state; native inputs keep semantics.',
      },
    },
  },
};
export default meta;

/* ── 1 · Overview ─────────────────────────────────────────────────── */

export const Overview: StoryObj = {
  render: () => {
    const [theme, setTheme] = createSignal('Void Dark');
    const [endpoint, setEndpoint] = createSignal('https://worker.axis.hoox.sh');
    const [interval, setInterval] = createSignal('1h');
    const [live, setLive] = createSignal(true);
    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Anatomy — one field, four answers</h2>
          <p>
            Label, control, hint, and message share a single vertical rhythm. The focus ring is the
            accent edge plus a 3px halo; the label lifts to accent at the same time. Error and
            success messages slide in from −3px so the eye catches the change without the control
            moving.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <div class="axi-panel-head">
              <h3>Live sample</h3>
              <span class="axi-tag">Studio / Settings</span>
            </div>
            <StudioField
              label="Theme name"
              for="axi-overview-theme"
              hint="Saving with an existing name replaces that theme."
              counter={`${theme().length}/40`}
            >
              <StudioInput
                id="axi-overview-theme"
                value={theme()}
                maxLength={40}
                onInput={setTheme}
                placeholder="Theme name"
              />
            </StudioField>
            <StudioField
              label="Worker endpoint"
              for="axi-overview-endpoint"
              hint="No trailing slash. Test before saving."
              optional
            >
              <StudioInput
                id="axi-overview-endpoint"
                mono
                icon={<Icons.server />}
                value={endpoint()}
                onInput={setEndpoint}
                placeholder="https://…"
                copyable
              />
            </StudioField>
            <StudioField label="Interval" for="axi-overview-interval" hint="Chart timeframe.">
              <StudioSelect
                id="axi-overview-interval"
                value={interval()}
                icon={<Icons.clock />}
                onChange={setInterval}
              >
                <option value="1m">1 minute</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="1D">1 day</option>
              </StudioSelect>
            </StudioField>
            <StudioToggle
              checked={live()}
              label="Live re-run"
              hint="Re-run on every tick. Press Space to toggle while focused."
              onChange={setLive}
            />
          </div>

          <div class="axi-panel axi-panel--elev">
            <div class="axi-panel-head">
              <h3>What changed</h3>
              <span class="axi-tag">v2</span>
            </div>
            <ul class="axi-legend">
              <li>
                <span class="axi-dot axi-dot--accent" /> Label lifts to accent on focus
              </li>
              <li>
                <span class="axi-dot axi-dot--ok" /> Success edge + check replace guesswork
              </li>
              <li>
                <span class="axi-dot axi-dot--err" /> Error edge + icon + message, announced
              </li>
              <li>
                <span class="axi-dot axi-dot--faint" /> Clear / reveal / copy appear only when
                useful
              </li>
            </ul>
            <StudioHint>
              Optional fields get a quiet tag; required fields get a red marker. Neither shouts —
              the label still leads.
            </StudioHint>
            <div class="axi-note">
              <strong>Pixel contract</strong> — control height is <code>var(--ax-control-h)</code>,
              radius is <code>var(--radius-input)</code>, and the halo is always{' '}
              <code>0 0 0 3px</code> at 18% accent.
            </div>
          </div>
        </div>
      </div>
    );
  },
};

/* ── 2 · States ───────────────────────────────────────────────────── */

export const States: StoryObj = {
  render: () => (
    <div class="axi-demo">
      <div class="axi-demo-head">
        <h2>States — the edge tells the truth</h2>
        <p>
          Default, filled, valid, invalid, loading, read-only, and disabled all keep the same
          height. The trailing slot is a status lane: spinner, check, or alert, never all three.
        </p>
      </div>
      <div class="axi-grid4">
        <div class="axi-specimen">
          <p class="axi-specimen-label">Default</p>
          <StudioInput placeholder="Search symbol" />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Filled</p>
          <StudioInput value="BTCUSDT" mono />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Valid</p>
          <StudioInput value="worker.axis.hoox.sh" valid />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Invalid</p>
          <StudioInput value="worker.local" invalid />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Loading</p>
          <StudioInput value="Checking endpoint…" loading />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Read-only</p>
          <StudioInput value="pn_live_…" mono readonly copyable />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Disabled</p>
          <StudioInput value="locked" disabled />
        </div>
        <div class="axi-specimen">
          <p class="axi-specimen-label">Number + stepper</p>
          <StudioInput type="number" value={42} min={1} max={100} step={1} suffix="bars" />
        </div>
      </div>

      <div class="axi-grid2">
        <div class="axi-panel">
          <p class="axi-specimen-label">Field with hint</p>
          <StudioField label="Symbol" for="axi-states-symbol" hint="Exchange pair, uppercase.">
            <StudioInput id="axi-states-symbol" mono placeholder="BTCUSDT" />
          </StudioField>
        </div>
        <div class="axi-panel">
          <p class="axi-specimen-label">Field with error</p>
          <StudioField
            label="Worker URL"
            for="axi-states-url"
            error="URL must start with https://"
            hint="The browser blocks mixed content."
          >
            <StudioInput id="axi-states-url" mono invalid value="worker.local" />
          </StudioField>
        </div>
      </div>
    </div>
  ),
};

/* ── 3 · Smart input ──────────────────────────────────────────────── */

export const SmartInput: StoryObj = {
  render: () => {
    const [symbol, setSymbol] = createSignal('BTCUSDT');
    const [name, setName] = createSignal('Void Dark');
    const [qty, setQty] = createSignal(12);
    const [token, setToken] = createSignal('pn_live_9f2c7a1e4b6d8c0f');
    const [secret, setSecret] = createSignal('sk_live_9f2c7a1e4b6d8c0f');
    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Smart input — actions appear only when they earn their space</h2>
          <p>
            Clear, reveal, copy, and the counter live in the trailing lane. They fade in with the
            value, scale on press, and never shift the text baseline. Keyboard hints hide the moment
            the field is focused.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Search + clear + shortcut hint</p>
            <StudioField
              label="Symbol"
              for="axi-smart-symbol"
              hint="Type to filter; clear appears with the value."
            >
              <StudioInput
                id="axi-smart-symbol"
                icon={<Icons.search />}
                value={symbol()}
                onInput={setSymbol}
                placeholder="Search symbol"
                clearable
              />
            </StudioField>
            <StudioField
              label="Command"
              for="axi-smart-command"
              hint="Shortcut hides once focused."
            >
              <StudioInput
                id="axi-smart-command"
                icon={<Icons.zap />}
                placeholder="Jump to panel…"
                kbd="⌘K"
              />
            </StudioField>
            <p class="axi-caption">Value: {symbol() || '—'}</p>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Counter + maxLength</p>
            <StudioField
              label="Theme name"
              for="axi-smart-name"
              hint="The in-field counter is the same number the field enforces."
            >
              <StudioInput
                id="axi-smart-name"
                value={name()}
                onInput={setName}
                maxLength={32}
                showCount
                placeholder="Theme name"
              />
            </StudioField>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Number stepper + suffix</p>
            <StudioField
              label="Warmup bars"
              for="axi-smart-qty"
              hint="Step buttons respect min / max / step."
            >
              <StudioInput
                id="axi-smart-qty"
                type="number"
                mono
                min={1}
                max={100}
                step={1}
                value={qty()}
                onInput={(v) => setQty(Number(v))}
                suffix="bars"
              />
            </StudioField>
            <p class="axi-caption">Value: {qty()}</p>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Copy + reveal</p>
            <StudioField
              label="Session token"
              for="axi-smart-token"
              hint="Copy keeps the value in the session vault."
            >
              <StudioInput id="axi-smart-token" mono value={token()} onInput={setToken} copyable />
            </StudioField>
            <StudioField
              label="API secret"
              for="axi-smart-secret"
              hint="Reveal is local; the value is never logged."
            >
              <StudioInput
                id="axi-smart-secret"
                type="password"
                mono
                value={secret()}
                onInput={setSecret}
                reveal
              />
            </StudioField>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Prefix + suffix text</p>
            <StudioField label="Latency budget" for="axi-smart-latency">
              <StudioInput
                id="axi-smart-latency"
                type="number"
                prefix="≤"
                suffix="ms"
                value={250}
                min={0}
                step={10}
                mono
              />
            </StudioField>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Leading icon + valid state</p>
            <StudioField
              label="Endpoint"
              for="axi-smart-endpoint"
              success="Reachable from this browser."
            >
              <StudioInput
                id="axi-smart-endpoint"
                icon={<Icons.wifi />}
                mono
                value="https://worker.axis.hoox.sh"
                valid
                copyable
              />
            </StudioField>
          </div>
        </div>

        <div class="axi-note">
          <strong>Rule</strong> — actions are contextual, not permanent. An empty field shows a
          shortcut hint; a filled field swaps it for clear / copy. Actions sit on the trailing lane,
          so the text baseline never reflows.
        </div>
      </div>
    );
  },
};

/* ── 4 · Validation ───────────────────────────────────────────────── */

export const Validation: StoryObj = {
  render: () => {
    const [email, setEmail] = createSignal('');
    const [touched, setTouched] = createSignal(false);
    const [url, setUrl] = createSignal('worker.local');
    const [urlState, setUrlState] = createSignal<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
      if (timer) clearTimeout(timer);
    });

    const emailValid = () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email());
    const emailError = () =>
      touched() && email().length > 0 && !emailValid()
        ? 'Enter a complete email address.'
        : undefined;
    const emailSuccess = () =>
      touched() && emailValid() ? 'Looks good — we can reach you.' : undefined;

    const checkUrl = (value: string) => {
      setUrl(value);
      setUrlState(value ? 'loading' : 'idle');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setUrlState(/^https:\/\/[^\s]+$/.test(value) ? 'valid' : 'invalid');
      }, 650);
    };

    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Validation — reward early, punish late</h2>
          <p>
            Do not shout while the user is still typing. Validate on blur, then switch to live
            feedback once the field has been touched. Async checks use the same status lane with a
            spinner, so the edge never jumps.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Blur-then-live</p>
            <StudioField
              label="Email"
              for="axi-val-email"
              hint="Used for alert delivery only."
              error={emailError()}
              success={emailSuccess()}
              required
            >
              <StudioInput
                id="axi-val-email"
                type="email"
                value={email()}
                invalid={!!emailError()}
                valid={!!emailSuccess()}
                onInput={(v) => {
                  setEmail(v);
                  if (touched()) setTouched(true);
                }}
                onBlur={() => setTouched(true)}
                placeholder="you@domain.com"
                autocomplete="email"
                clearable
              />
            </StudioField>
            <p class="axi-caption">
              Touched: {touched() ? 'yes' : 'no'} · valid: {emailValid() ? 'yes' : 'no'}
            </p>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Async check</p>
            <StudioField
              label="Worker URL"
              for="axi-val-url"
              hint="https only. We test from this browser."
              error={urlState() === 'invalid' ? 'That host did not answer /health.' : undefined}
              success={urlState() === 'valid' ? 'Health check passed.' : undefined}
            >
              <StudioInput
                id="axi-val-url"
                mono
                icon={<Icons.server />}
                value={url()}
                onInput={checkUrl}
                invalid={urlState() === 'invalid'}
                valid={urlState() === 'valid'}
                loading={urlState() === 'loading'}
                placeholder="https://…"
                clearable
              />
            </StudioField>
            <div class="axi-row">
              <span class="axi-tag">state: {urlState()}</span>
              <span class="axi-caption">Debounced 650ms</span>
            </div>
          </div>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Required + optional</p>
            <StudioField
              label="API key"
              for="axi-val-key"
              required
              hint="Required for secured backends."
            >
              <StudioInput id="axi-val-key" type="password" mono placeholder="X-API-Key" reveal />
            </StudioField>
            <StudioField
              label="Passphrase"
              for="axi-val-pass"
              optional
              hint="Only some venues ask for this."
            >
              <StudioInput id="axi-val-pass" type="password" mono placeholder="optional" reveal />
            </StudioField>
          </div>
          <div class="axi-panel">
            <p class="axi-specimen-label">Select validation</p>
            <StudioField label="Interval" for="axi-val-interval" error="Pick a listed interval.">
              <StudioSelect id="axi-val-interval" invalid value="">
                <option value="" disabled>
                  Select…
                </option>
                <option value="1m">1 minute</option>
                <option value="1h">1 hour</option>
              </StudioSelect>
            </StudioField>
            <StudioField label="Venue" for="axi-val-venue" hint="Native CEX or CCXT gateway.">
              <StudioSelect id="axi-val-venue" value="binance" icon={<Icons.server />}>
                <option value="binance">Binance</option>
                <option value="okx">OKX</option>
                <option value="bybit">Bybit</option>
              </StudioSelect>
            </StudioField>
          </div>
        </div>
      </div>
    );
  },
};

/* ── 5 · Select + toggle ──────────────────────────────────────────── */

export const SelectAndToggle: StoryObj = {
  render: () => {
    const [brand, setBrand] = createSignal(true);
    const [market, setMarket] = createSignal(true);
    const [data, setData] = createSignal(false);
    const [layout, setLayout] = createSignal(true);
    const [compact, setCompact] = createSignal(true);
    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Select &amp; toggle — quiet affordances</h2>
          <p>
            Selects keep the native list (keyboard, type-ahead, mobile sheet) and add a currentColor
            chevron that rotates on press. Toggles use a spring thumb, a soft accent glow when on,
            and a 3px focus halo.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Selects</p>
            <StudioField label="Interval" for="axi-sel-interval">
              <StudioSelect id="axi-sel-interval" value="1h">
                <option value="1m">1 minute</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="1D">1 day</option>
              </StudioSelect>
            </StudioField>
            <StudioField label="With icon" for="axi-sel-icon">
              <StudioSelect id="axi-sel-icon" value="binance" icon={<Icons.database />}>
                <option value="binance">Binance</option>
                <option value="okx">OKX</option>
                <option value="bybit">Bybit</option>
              </StudioSelect>
            </StudioField>
            <StudioField label="Invalid" for="axi-sel-invalid" error="Pick a listed interval.">
              <StudioSelect id="axi-sel-invalid" invalid value="">
                <option value="" disabled>
                  Select…
                </option>
                <option value="1m">1 minute</option>
              </StudioSelect>
            </StudioField>
            <StudioField label="Disabled" for="axi-sel-disabled">
              <StudioSelect id="axi-sel-disabled" disabled value="1h">
                <option value="1h">1 hour</option>
              </StudioSelect>
            </StudioField>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Toggle grid</p>
            <div class="ax-toggle-grid">
              <StudioToggle
                checked={brand()}
                label="Brand"
                hint="AXIS wordmark."
                onChange={setBrand}
              />
              <StudioToggle
                checked={market()}
                label="Market"
                hint="Symbol, interval, chart type."
                onChange={setMarket}
              />
              <StudioToggle
                checked={data()}
                label="Data"
                hint="Venue and Load."
                onChange={setData}
              />
              <StudioToggle
                checked={layout()}
                label="Layout"
                hint="Chart layout menu."
                onChange={setLayout}
              />
            </div>
            <p class="axi-specimen-label">Sizes</p>
            <StudioToggle
              checked={compact()}
              size="sm"
              label="Compact rows"
              hint="Small switch, same hit area."
              onChange={setCompact}
            />
            <StudioToggle
              checked
              disabled
              size="sm"
              label="Locked"
              hint="Disabled stays dimmed."
              onChange={() => {}}
            />
            <p class="axi-caption">
              On:{' '}
              {[brand() && 'brand', market() && 'market', data() && 'data', layout() && 'layout']
                .filter(Boolean)
                .join(' · ') || 'none'}
            </p>
          </div>
        </div>
      </div>
    );
  },
};

/* ── 6 · Color ────────────────────────────────────────────────────── */

export const Color: StoryObj = {
  render: () => {
    const [accent, setAccent] = createSignal('#8B9CFF');
    const [pine, setPine] = createSignal('color.red');
    const [rgb, setRgb] = createSignal('rgb(61, 220, 151)');
    const [alpha, setAlpha] = createSignal('rgba(139, 156, 255, 0.42)');
    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Color — text is the source of truth</h2>
          <p>
            Pine accepts hex, rgb(), rgba(), CSS names, and <code>color.*</code> enums. The field
            keeps the user's format when the swatch changes, shows the detected format as a chip,
            and marks an unparsable draft with the same red edge as any other input.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Formats</p>
            <StudioField label="Accent" for="axi-color-accent" hint="Hex stays hex.">
              <StudioColorInput id="axi-color-accent" value={accent()} onChange={setAccent} />
            </StudioField>
            <StudioField
              label="Pine enum"
              for="axi-color-pine"
              hint="color.red survives a swatch change."
            >
              <StudioColorInput id="axi-color-pine" value={pine()} onChange={setPine} />
            </StudioField>
            <StudioField label="RGB" for="axi-color-rgb" hint="rgb() is rewritten in place.">
              <StudioColorInput id="axi-color-rgb" value={rgb()} onChange={setRgb} />
            </StudioField>
            <StudioField label="Alpha" for="axi-color-alpha" hint="Checkerboard shows through.">
              <StudioColorInput id="axi-color-alpha" value={alpha()} onChange={setAlpha} />
            </StudioField>
            <StudioField
              label="Invalid draft"
              for="axi-color-invalid"
              error="Use #rrggbb, rgb(), rgba(), a CSS name, or color.name"
            >
              <StudioColorInput id="axi-color-invalid" value="not-a-color" onChange={() => {}} />
            </StudioField>
          </div>
          <div class="axi-panel axi-panel--elev">
            <p class="axi-specimen-label">Live state</p>
            <pre class="axi-json">
              {`accent  ${accent()}\n`}
              {`pine    ${pine()}\n`}
              {`rgb     ${rgb()}\n`}
              {`alpha   ${alpha()}`}
            </pre>
            <p class="axi-caption">
              Enter commits and blurs. Escape reverts to the last committed value. The format chip
              updates as you type.
            </p>
            <div class="axi-row">
              <span class="ax-chip ax-chip--tag" style={{ background: accent(), color: '#07080C' }}>
                accent
              </span>
              <span class="ax-chip ax-chip--tag" style={{ background: rgb(), color: '#07080C' }}>
                rgb
              </span>
              <span class="ax-chip ax-chip--tag" style={{ background: '#F23645', color: '#fff' }}>
                pine
              </span>
            </div>
            <StudioField label="Disabled" for="axi-color-disabled">
              <StudioColorInput
                id="axi-color-disabled"
                value="#3D4A6B"
                onChange={() => {}}
                disabled
              />
            </StudioField>
          </div>
        </div>
      </div>
    );
  },
};

/* ── 7 · Range + textarea ─────────────────────────────────────────── */

export const RangeAndTextarea: StoryObj = {
  render: () => {
    const [speed, setSpeed] = createSignal(1.5);
    const [opacity, setOpacity] = createSignal(0.8);
    const [scale, setScale] = createSignal(1);
    const [notes, setNotes] = createSignal('Momentum fades when volume dries up.');
    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Range &amp; textarea — same edge, different shape</h2>
          <p>
            The range fills to the thumb with a single custom property, so dragging is
            compositor-only. The value chip mirrors <code>aria-valuetext</code>. Textareas share the
            focus halo and can autosize without a resize handle.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Ranges</p>
            <StudioField label="Marquee speed" for="axi-range-speed" hint="0.5×–3×.">
              <StudioRange
                id="axi-range-speed"
                value={speed()}
                min={0.5}
                max={3}
                step={0.5}
                format={(v) => `${v.toFixed(1)}×`}
                onInput={setSpeed}
              />
            </StudioField>
            <StudioField label="Band opacity" for="axi-range-opacity" hint="20–100%.">
              <StudioRange
                id="axi-range-opacity"
                value={opacity()}
                min={0.2}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onInput={setOpacity}
              />
            </StudioField>
            <StudioField
              label="UI scale"
              for="axi-range-scale"
              hint="Live preview of text and spacing."
            >
              <StudioRange
                id="axi-range-scale"
                value={scale()}
                min={0.85}
                max={1.25}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onInput={setScale}
              />
            </StudioField>
            <StudioField label="Disabled" for="axi-range-disabled">
              <StudioRange
                id="axi-range-disabled"
                value={0.5}
                min={0}
                max={1}
                step={0.1}
                disabled
              />
            </StudioField>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Textareas</p>
            <StudioField
              label="Notes"
              for="axi-notes"
              hint="Autosizes with content; counter stays pinned."
            >
              <StudioTextarea
                id="axi-notes"
                value={notes()}
                onInput={setNotes}
                autosize
                showCount
                maxLength={140}
                placeholder="Write a note…"
              />
            </StudioField>
            <StudioField
              label="Strategy comment"
              for="axi-notes-mono"
              hint="Mono for code-adjacent text."
            >
              <StudioTextarea
                id="axi-notes-mono"
                mono
                rows={4}
                value={'//@version=6\nstrategy("Momentum", overlay=true)'}
              />
            </StudioField>
            <StudioField label="Invalid" for="axi-notes-invalid" error="Comment is required.">
              <StudioTextarea id="axi-notes-invalid" invalid value="" placeholder="Required" />
            </StudioField>
          </div>
        </div>
      </div>
    );
  },
};

/* ── 8 · Keyboard + a11y ──────────────────────────────────────────── */

export const KeyboardAndA11y: StoryObj = {
  render: () => {
    const [value, setValue] = createSignal('');
    const [last, setLast] = createSignal('—');
    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Keyboard &amp; accessibility contract</h2>
          <p>
            Native controls keep the platform contract. The shell adds visible focus, described-by
            wiring, and explicit Enter / Escape hooks without trapping focus.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <p class="axi-specimen-label">Try it</p>
            <StudioField
              label="Command"
              for="axi-kbd-input"
              hint="Enter commits, Escape clears, Tab moves on."
            >
              <StudioInput
                id="axi-kbd-input"
                icon={<Icons.zap />}
                value={value()}
                onInput={setValue}
                onEnter={(v) => setLast(`Enter → ${v || '(empty)'}`)}
                onEscape={() => {
                  setValue('');
                  setLast('Escape → cleared');
                }}
                placeholder="Type and press Enter"
                kbd="↵"
                clearable
              />
            </StudioField>
            <p class="axi-caption">Last event: {last()}</p>
            <div class="axi-row">
              <span class="axi-kbd">Tab</span>
              <span class="axi-kbd">Shift+Tab</span>
              <span class="axi-kbd">Enter</span>
              <span class="axi-kbd">Esc</span>
              <span class="axi-kbd">Space</span>
            </div>
          </div>

          <div class="axi-panel">
            <p class="axi-specimen-label">Checklist</p>
            <ul class="axi-legend">
              <li>
                <span class="axi-dot axi-dot--accent" /> Label is a real{' '}
                <code>&lt;label for&gt;</code>
              </li>
              <li>
                <span class="axi-dot axi-dot--accent" /> Hint + error ids wired with{' '}
                <code>aria-describedby</code>
              </li>
              <li>
                <span class="axi-dot axi-dot--accent" /> Invalid sets <code>aria-invalid</code>
                {'; '}error uses <code>role="alert"</code>
              </li>
              <li>
                <span class="axi-dot axi-dot--ok" /> Toggle is a native checkbox with{' '}
                <code>role="switch"</code>
              </li>
              <li>
                <span class="axi-dot axi-dot--ok" /> Password reveal sets <code>aria-pressed</code>
              </li>
              <li>
                <span class="axi-dot axi-dot--faint" /> Reduced motion removes every transform, not
                the state
              </li>
            </ul>
            <div class="axi-note">
              <strong>Never</strong> remove the outline without a replacement. The shell's 3px halo
              is the replacement, and it is visible in both themes.
            </div>
          </div>
        </div>
      </div>
    );
  },
};

/* ── 9 · Playground ───────────────────────────────────────────────── */

export const Playground: StoryObj = {
  render: () => {
    const [theme, setTheme] = createSignal('Void Dark');
    const [endpoint, setEndpoint] = createSignal('https://worker.axis.hoox.sh');
    const [interval, setInterval] = createSignal('1h');
    const [live, setLive] = createSignal(true);
    const [accent, setAccent] = createSignal('#8B9CFF');
    const [speed, setSpeed] = createSignal(1.5);
    const [notes, setNotes] = createSignal('');
    const [saved, setSaved] = createSignal('idle');
    const [lastAction, setLastAction] = createSignal('—');
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
      if (saveTimer) clearTimeout(saveTimer);
    });

    const save = () => {
      setSaved('loading');
      setLastAction('Saving…');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        setSaved('done');
        setLastAction(`Saved “${theme()}” at ${new Date().toLocaleTimeString()}`);
        saveTimer = setTimeout(() => setSaved('idle'), 900);
      }, 700);
    };

    const summary = createMemo(() =>
      JSON.stringify(
        {
          theme: theme(),
          endpoint: endpoint(),
          interval: interval(),
          live: live(),
          accent: accent(),
          speed: speed(),
          notes: notes(),
        },
        null,
        2,
      ),
    );

    return (
      <div class="axi-demo">
        <div class="axi-demo-head">
          <h2>Playground — a real settings form</h2>
          <p>
            Every control below is the production primitive. Tab through, clear, reveal, copy, step,
            drag, and press Enter. The summary on the right is the exact state a Save would persist.
          </p>
        </div>

        <div class="axi-grid2">
          <div class="axi-panel">
            <div class="axi-panel-head">
              <h3>Theme &amp; engine</h3>
              <span class="axi-tag">{saved()}</span>
            </div>
            <StudioField
              label="Theme name"
              for="axi-play-theme"
              hint="A matching name replaces that theme."
              counter={`${theme().length}/40`}
              required
            >
              <StudioInput
                id="axi-play-theme"
                value={theme()}
                onInput={setTheme}
                maxLength={40}
                placeholder="Theme name"
                onEnter={save}
              />
            </StudioField>
            <StudioField
              label="Worker endpoint"
              for="axi-play-endpoint"
              hint="No trailing slash. Copy keeps the value in the session vault."
              optional
            >
              <StudioInput
                id="axi-play-endpoint"
                mono
                icon={<Icons.server />}
                value={endpoint()}
                onInput={setEndpoint}
                copyable
                clearable
                placeholder="https://…"
              />
            </StudioField>
            <StudioField label="Interval" for="axi-play-interval" hint="Chart timeframe.">
              <StudioSelect
                id="axi-play-interval"
                value={interval()}
                onChange={setInterval}
                icon={<Icons.clock />}
              >
                <option value="1m">1 minute</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="1D">1 day</option>
              </StudioSelect>
            </StudioField>
            <StudioToggle
              checked={live()}
              label="Live re-run"
              hint="Re-run on every tick. Space toggles while focused."
              onChange={setLive}
            />
          </div>

          <div class="axi-panel">
            <div class="axi-panel-head">
              <h3>Presentation</h3>
              <span class="axi-tag">live</span>
            </div>
            <StudioField label="Accent" for="axi-play-accent" hint="Hex, rgb(), name, or color.*">
              <StudioColorInput id="axi-play-accent" value={accent()} onChange={setAccent} />
            </StudioField>
            <StudioField label="Marquee speed" for="axi-play-speed" hint="0.5×–3×.">
              <StudioRange
                id="axi-play-speed"
                value={speed()}
                min={0.5}
                max={3}
                step={0.5}
                format={(v) => `${v.toFixed(1)}×`}
                onInput={setSpeed}
              />
            </StudioField>
            <StudioField
              label="Notes"
              for="axi-play-notes"
              hint="Autosizes; the counter stays pinned."
              counter={`${notes().length}/140`}
            >
              <StudioTextarea
                id="axi-play-notes"
                value={notes()}
                onInput={setNotes}
                autosize
                maxLength={140}
                placeholder="Anything the next you should know…"
              />
            </StudioField>
            <div class="axi-row">
              <StudioButton variant="primary" loading={saved() === 'loading'} onClick={save}>
                {saved() === 'loading' ? 'Working…' : saved() === 'done' ? 'Done' : 'Save theme'}
              </StudioButton>
              <span class="axi-caption">{lastAction()}</span>
            </div>
          </div>
        </div>

        <div class="axi-panel axi-panel--elev">
          <div class="axi-panel-head">
            <h3>Persisted state</h3>
            <span class="axi-tag">JSON</span>
          </div>
          <pre class="axi-json">{summary()}</pre>
        </div>
      </div>
    );
  },
};

/* ── 10 · Contract ────────────────────────────────────────────────── */

export const Contract: StoryObj = {
  render: () => (
    <div class="axi-demo">
      <div class="axi-demo-head">
        <h2>Contract — copy the shape, keep the tokens</h2>
        <p>
          One shell, one native control, one status lane. Every studio page uses these primitives;
          raw <code>&lt;input class="ax-input"&gt;</code> still gets the same edge and focus halo.
        </p>
      </div>

      <div class="axd-card">
        <p class="axd-kicker">Pieces</p>
        <table class="axd-spec">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Responsibility</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>StudioField</td>
              <td>
                label row, optional/required tags, counter, hint, error, success, described-by
                context
              </td>
            </tr>
            <tr>
              <td>StudioInput</td>
              <td>
                chrome, icon/prefix/suffix, clear, reveal, copy, stepper, counter, status lane,
                compact shell, Enter/Escape
              </td>
            </tr>
            <tr>
              <td>StudioSelect</td>
              <td>native list + currentColor chevron + the same focus / invalid edge</td>
            </tr>
            <tr>
              <td>StudioToggle</td>
              <td>native checkbox, role=switch, spring thumb, sm/md sizes</td>
            </tr>
            <tr>
              <td>StudioColorInput</td>
              <td>swatch + text source of truth, format chip, Escape revert</td>
            </tr>
            <tr>
              <td>StudioRange</td>
              <td>filled track from one custom property, value chip, aria-valuetext</td>
            </tr>
            <tr>
              <td>StudioTextarea</td>
              <td>autosize, counter, same shell language</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="axi-grid2">
        <div class="axi-panel">
          <p class="axi-specimen-label">Do</p>
          <ul class="axi-legend">
            <li>
              <span class="axi-dot axi-dot--ok" /> Put the unit in the suffix, not the label
            </li>
            <li>
              <span class="axi-dot axi-dot--ok" /> Use <code>counter</code> for hard limits; show
              the same number in the field
            </li>
            <li>
              <span class="axi-dot axi-dot--ok" /> Let errors replace success, never both
            </li>
            <li>
              <span class="axi-dot axi-dot--ok" /> Keep one feedback owner per action
            </li>
          </ul>
        </div>
        <div class="axi-panel">
          <p class="axi-specimen-label">Don't</p>
          <ul class="axi-legend">
            <li>
              <span class="axi-dot axi-dot--err" /> Shake on every keystroke
            </li>
            <li>
              <span class="axi-dot axi-dot--err" /> Hide the label behind a placeholder
            </li>
            <li>
              <span class="axi-dot axi-dot--err" /> Use color alone for valid / invalid
            </li>
            <li>
              <span class="axi-dot axi-dot--err" /> Stack a spinner, a toast, and a modal for one
              save
            </li>
          </ul>
        </div>
      </div>

      <div class="axi-note">
        <strong>Tokens</strong> — <code>--ax-control-h</code> height · <code>--radius-input</code>{' '}
        radius · <code>--border-w-input</code> edge · <code>--ui-motion-duration-fast</code> 120ms ·{' '}
        <code>--ui-motion-duration-base</code> 200ms · easing{' '}
        <code>cubic-bezier(0.2, 0.8, 0.2, 1)</code>. The shell's focus halo is{' '}
        <code>0 0 0 3px</code> at 18% accent.
      </div>
    </div>
  ),
};

// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared settings panels - extracted verbatim from the legacy
 * SettingsDialog modal (E6) so the dead 2452-line dialog could be deleted.
 * The Studio SettingsPage renders these; the dialog itself had no mount
 * points left (only comments referenced it).
 *
 * - ExchangeCredentialsPanel: per-venue key/secret/passphrase via the
 *   session vault (src/data/credentials) - never persisted.
 * - EditorIntelPanel: live-applied editor intelligence toggles.
 *
 * @module ui/settings/panels
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import {
  store,
  setStatus,
  flushPersist,
  setEditorFeatureBarEnabled,
  patchEditorIntel,
  resetEditorIntel,
  getEditorIntel,
} from '../../store';
import {
  AppButton,
  StudioField,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioSelect,
  StudioStatus,
  StudioToggle,
  useMicrofeedback,
} from '../studio';
import {
  INTEL_HOVER_MS_MAX,
  INTEL_HOVER_MS_MIN,
  INTEL_IDLE_MS_MAX,
  INTEL_IDLE_MS_MIN,
  INTEL_MAX_OPTIONS_MAX,
  INTEL_MAX_OPTIONS_MIN,
  INTEL_TAB_SWITCH_MS_MAX,
  INTEL_TAB_SWITCH_MS_MIN,
  INTEL_TIMEOUT_MS_MAX,
  INTEL_TIMEOUT_MS_MIN,
  type EditorIntelSettings,
} from '../../editor/editor-intel';
import * as cred from '../../data/credentials';
import { fetchSignedJson, hasSignedCreds } from '../../data/signed-fetch';
import type { VenueId } from '../../data/venues/types';
import {
  EXCHANGE_CREDENTIAL_VENUES,
  EXCHANGE_CREDENTIAL_VENUE_LABELS,
  ccxtNeedsPassword,
  defaultExchangeCredentialVenue,
  isExchangeCredentialVenue,
  normalizeCcxtExchangeId,
  venueNeedsPassphrase,
  type ExchangeCredentialVenue,
} from '../exchange-credentials-form';
import { bindCcxtSession, unbindCcxtSession } from '../../data/ccxt-session';
import type { GatewayMode } from '../../data/gateway';
import { writePluginField } from '../plugin-config';
import { Icons } from '../icons';

type CredentialMetaRow = {
  id: string;
  venue: string;
  label?: string;
  hasKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
};

function readCcxtPluginField(key: string): string {
  const bags = store.pluginsConfig || {};
  const src = bags['source:ccxt-rest'] as Record<string, unknown> | undefined;
  const stm = bags['stream:ccxt-ws'] as Record<string, unknown> | undefined;
  return String(src?.[key] ?? stm?.[key] ?? '').trim();
}

function activeCcxtGateway(): GatewayMode {
  const g = readCcxtPluginField('gateway');
  return g === 'pyne' || g === 'sidecar' ? g : 'auto';
}

/** Per-venue API key/secret/passphrase — session vault, never persist() secrets. */
/** Session-only exchange keys. Used by Settings studio page. */
export const ExchangeCredentialsPanel: Component = () => {
  const onCcxtSource = () => store.source === 'ccxt-rest' || store.live?.streamId === 'ccxt-ws';
  const [kind, setKind] = createSignal<'native' | 'ccxt'>(onCcxtSource() ? 'ccxt' : 'native');
  const [venue, setVenue] = createSignal<ExchangeCredentialVenue>(
    defaultExchangeCredentialVenue(store.provider?.venue),
  );
  const [ccxtExchange, setCcxtExchange] = createSignal(readCcxtPluginField('exchange'));
  const [apiKey, setApiKey] = createSignal('');
  const [secret, setSecret] = createSignal('');
  const [passphrase, setPassphrase] = createSignal('');
  const [uid, setUid] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [msgTone, setMsgTone] = createSignal<'err' | 'ok' | 'info'>('err');
  const [rev, setRev] = createSignal(0);
  const saveFb = useMicrofeedback({ successHoldMs: 700, errorHoldMs: 1100 });
  const removeFb = useMicrofeedback({ successHoldMs: 700, errorHoldMs: 1100 });
  const testFb = useMicrofeedback({ successHoldMs: 800, errorHoldMs: 1100 });

  const unsub = cred.subscribeCredentials(() => setRev((n) => n + 1));
  onCleanup(unsub);

  const meta = createMemo((): CredentialMetaRow | null => {
    rev();
    const rows = cred.listCredentialMeta() as CredentialMetaRow[];
    if (kind() === 'ccxt') {
      const ex = normalizeCcxtExchangeId(ccxtExchange());
      return rows.find((m) => m.id === cred.ccxtCredentialId(ex)) ?? null;
    }
    const v = venue();
    return rows.find((m) => m.venue === v && !String(m.id).startsWith('ccxt:')) ?? null;
  });

  const hasSaved = createMemo(() => {
    rev();
    const m = meta();
    return !!(m && (m.hasKey || m.hasSecret || m.hasPassphrase));
  });

  const needsPass = createMemo(() =>
    kind() === 'ccxt' ? ccxtNeedsPassword(ccxtExchange()) : venueNeedsPassphrase(venue()),
  );

  const sessionLabel = () => {
    if (!hasSaved()) return 'No key';
    if (kind() === 'ccxt') {
      const ex = normalizeCcxtExchangeId(ccxtExchange()) || 'ccxt';
      return `Saved · ${ex}`;
    }
    return `Saved · ${venue()}`;
  };

  const clearSecrets = () => {
    setApiKey('');
    setSecret('');
    setPassphrase('');
    setUid('');
  };

  const onVenueChange = (raw: string) => {
    if (!isExchangeCredentialVenue(raw)) return;
    setVenue(raw);
    clearSecrets();
    setMsg('');
  };

  const onSave = async () => {
    const key = apiKey().trim();
    const sec = secret().trim();
    const pass = passphrase().trim();
    if (!key || !sec) {
      const err = 'API key and secret are required';
      setMsgTone('err');
      setMsg(err);
      throw new Error(err);
    }
    if (needsPass() && !pass) {
      const err = 'Passphrase is required for this venue';
      setMsgTone('err');
      setMsg(err);
      throw new Error(err);
    }
    try {
      if (kind() === 'ccxt') {
        const ex = normalizeCcxtExchangeId(ccxtExchange());
        if (!ex) {
          const err = 'Set the CCXT exchange id first';
          setMsgTone('err');
          setMsg(err);
          throw new Error(err);
        }
        cred.putCcxtCredential({
          exchange: ex,
          apiKey: key,
          secret: sec,
          passphrase: pass || undefined,
          uid: uid().trim() || undefined,
        });
        if (!readCcxtPluginField('exchange')) {
          writePluginField('source:ccxt-rest', 'exchange', ex);
          writePluginField('stream:ccxt-ws', 'exchange', ex);
          void flushPersist();
        }
        await bindCcxtSession(activeCcxtGateway(), ex);
        clearSecrets();
        setMsgTone('ok');
        setMsg(`CCXT key bound for ${ex} · session only`);
        setStatus('ready', `CCXT key saved · ${ex} · session only`);
        return;
      }
      const v = venue();
      cred.putCredential({
        venue: v,
        apiKey: key,
        secret: sec,
        passphrase: needsPass() ? pass : undefined,
      });
      clearSecrets();
      setMsgTone('ok');
      setMsg(`Key saved for ${v} · session only`);
      setStatus('ready', `Exchange key saved · ${v} · session only`);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Save failed';
      setMsgTone('err');
      setMsg(text);
      throw err instanceof Error ? err : new Error(text);
    }
  };

  const onRemove = async () => {
    const row = meta();
    const id = row?.id;
    if (!id) {
      const err = 'No saved key for this venue';
      setMsgTone('err');
      setMsg(err);
      throw new Error(err);
    }
    cred.deleteCredential(id);
    if (kind() === 'ccxt') {
      const ex = normalizeCcxtExchangeId(ccxtExchange());
      if (ex) await unbindCcxtSession(activeCcxtGateway(), ex);
    }
    clearSecrets();
    setMsgTone('info');
    setMsg('Key removed from this session');
    setStatus('ready', `Exchange key removed · ${kind() === 'ccxt' ? ccxtExchange() : venue()}`);
  };

  const onTestKey = async () => {
    const v = venue();
    if (!hasSignedCreds(v as VenueId)) {
      const err = 'Save a key first, then test';
      setMsgTone('err');
      setMsg(err);
      throw new Error(err);
    }
    setMsg('');
    try {
      await fetchSignedJson({
        venue: v as VenueId,
        path: '/api/v3/klines',
        query: { symbol: 'BTCUSDT', interval: '1d', limit: 1 },
        skipWorkerProxy: true,
      });
      setMsgTone('ok');
      setMsg(`${v} verified · signed fetch OK`);
      setStatus('ready', `${v} key verified · signed fetch OK`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let text: string;
      if (/401|403/.test(raw)) text = `Key rejected (${v}): ${raw}`;
      else if (/CORS|network|fetch/i.test(raw))
        text = `Network/CORS error — key may be valid but direct fetch blocked`;
      else text = `Test failed: ${raw}`;
      setMsgTone('err');
      setMsg(text);
      throw new Error(text);
    }
  };

  return (
    <StudioSection
      title="Exchange API keys"
      lead="Session vault only — never written to disk or localStorage."
      testId="axis-settings-exchange-keys"
      headerEnd={<StudioStatus status={hasSaved() ? 'healthy' : 'idle'} label={sessionLabel()} />}
    >
      <p class="ax-hint" data-testid="axis-exchange-session-note">
        Native CEX keys sign in the browser. CCXT keys bind a datafeed session handle — the secret
        never appears in URLs.
      </p>

      <div class="ax-token-grid">
        <StudioField label="Key type" for="axis-exchange-key-kind">
          <StudioSelect
            id="axis-exchange-key-kind"
            testId="axis-exchange-key-kind"
            value={kind()}
            onChange={(v) => {
              setKind(v === 'ccxt' ? 'ccxt' : 'native');
              clearSecrets();
              setMsg('');
            }}
          >
            <option value="native">Native CEX</option>
            <option value="ccxt">CCXT gateway</option>
          </StudioSelect>
        </StudioField>

        <Show
          when={kind() === 'ccxt'}
          fallback={
            <StudioField
              label="Venue"
              for="axis-exchange-venue"
              hint="Binance, OKX, Bybit, Coinbase, Kraken…"
            >
              <StudioSelect
                id="axis-exchange-venue"
                testId="axis-exchange-venue"
                value={venue()}
                onChange={onVenueChange}
              >
                <For each={[...EXCHANGE_CREDENTIAL_VENUES]}>
                  {(v) => <option value={v}>{EXCHANGE_CREDENTIAL_VENUE_LABELS[v]}</option>}
                </For>
              </StudioSelect>
            </StudioField>
          }
        >
          <StudioField
            label="CCXT exchange id"
            for="axis-exchange-ccxt-id"
            hint="Lowercase id from the gateway list (bybit, bitget, mexc…)."
          >
            <StudioInput
              id="axis-exchange-ccxt-id"
              mono
              testId="axis-exchange-ccxt-id"
              value={ccxtExchange()}
              onInput={(v) => setCcxtExchange(normalizeCcxtExchangeId(v))}
              placeholder="bybit, bitget, mexc, …"
              spellcheck={false}
              autocomplete="off"
            />
          </StudioField>
        </Show>

        <StudioField
          label="API key"
          for="axis-exchange-api-key"
          hint={meta()?.hasKey && !apiKey() ? 'saved in session' : undefined}
        >
          <StudioInput
            id="axis-exchange-api-key"
            type="password"
            mono
            testId="axis-exchange-api-key"
            value={apiKey()}
            onInput={setApiKey}
            placeholder={meta()?.hasKey ? '••••••••  saved' : 'API key'}
            spellcheck={false}
            autocomplete="off"
          />
        </StudioField>

        <StudioField
          label="Secret"
          for="axis-exchange-secret"
          hint={meta()?.hasSecret && !secret() ? 'saved in session' : undefined}
        >
          <StudioInput
            id="axis-exchange-secret"
            type="password"
            mono
            testId="axis-exchange-secret"
            value={secret()}
            onInput={setSecret}
            placeholder={meta()?.hasSecret ? '••••••••  saved' : 'API secret'}
            spellcheck={false}
            autocomplete="off"
          />
        </StudioField>

        <Show when={needsPass()}>
          <StudioField
            label="Passphrase"
            for="axis-exchange-passphrase"
            hint={meta()?.hasPassphrase && !passphrase() ? 'saved in session' : undefined}
          >
            <StudioInput
              id="axis-exchange-passphrase"
              type="password"
              mono
              testId="axis-exchange-passphrase"
              value={passphrase()}
              onInput={setPassphrase}
              placeholder={meta()?.hasPassphrase ? '••••••••  saved' : 'Passphrase'}
              spellcheck={false}
              autocomplete="off"
            />
          </StudioField>
        </Show>

        <Show when={kind() === 'ccxt'}>
          <StudioField
            label="UID (optional)"
            for="axis-exchange-uid"
            hint="Required by some venues (e.g. BitMEX)."
          >
            <StudioInput
              id="axis-exchange-uid"
              mono
              testId="axis-exchange-uid"
              value={uid()}
              onInput={setUid}
              placeholder="uid"
              spellcheck={false}
              autocomplete="off"
            />
          </StudioField>
        </Show>
      </div>

      <div class="ax-toolbar">
        <AppButton
          design="soft"
          tone="primary"
          size="sm"
          testId="axis-exchange-key-save"
          feedback={saveFb.state()}
          icon={<Icons.check />}
          onClick={() => void saveFb.run(onSave)}
        >
          Save
        </AppButton>
        <AppButton
          design="soft"
          tone="ghost"
          size="sm"
          testId="axis-exchange-key-test"
          feedback={testFb.state()}
          disabled={!hasSaved() || kind() === 'ccxt'}
          title={
            kind() === 'ccxt'
              ? 'CCXT keys are verified on the next Load / Live'
              : 'Signed REST probe'
          }
          onClick={() => void testFb.run(onTestKey)}
        >
          Test key
        </AppButton>
        <AppButton
          design="soft"
          tone="danger"
          size="sm"
          testId="axis-exchange-key-remove"
          feedback={removeFb.state()}
          disabled={!hasSaved()}
          icon={<Icons.trash />}
          onClick={() => void removeFb.run(onRemove)}
        >
          Remove
        </AppButton>
      </div>

      <Show when={msg()}>
        <p
          class={
            msgTone() === 'ok'
              ? 'ax-hint ax-hint--accent'
              : msgTone() === 'info'
                ? 'ax-hint'
                : 'ax-error'
          }
          role={msgTone() === 'err' ? 'alert' : 'status'}
          data-testid="axis-exchange-key-msg"
        >
          {msg()}
        </p>
      </Show>

      <StudioHint>
        Public REST / WebSocket needs no key. Private endpoints and higher rate limits need a saved
        key for this session.
      </StudioHint>
    </StudioSection>
  );
};

function IntelCheck(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <StudioToggle
      id={props.id}
      testId={props.id}
      checked={props.checked}
      label={props.label}
      hint={props.hint}
      onChange={props.onChange}
    />
  );
}

function IntelNum(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = createSignal(String(props.value));
  createEffect(() => {
    setDraft(String(props.value));
  });
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(String(props.value));
      return;
    }
    const clamped = Math.min(props.max, Math.max(props.min, Math.round(n)));
    if (clamped !== props.value) props.onChange(clamped);
    setDraft(String(clamped));
  };
  // Studio input language: the unit rides in the input suffix, never in the
  // label — the label stays a noun, the field carries the dimension.
  const unit = () => (props.suffix ? props.suffix.trim() : undefined);
  return (
    <StudioField
      label={props.label}
      for={props.id}
      hint={`${props.hint} (${props.min}–${props.max}${unit() ?? ''}).`}
    >
      <StudioInput
        id={props.id}
        type="number"
        mono
        testId={props.id}
        selectOnFocus
        min={props.min}
        max={props.max}
        step={props.step ?? 50}
        suffix={unit()}
        value={draft()}
        onInput={(v) => setDraft(v)}
        onChange={(v) => commit(v)}
        onBlur={(v) => commit(v)}
      />
    </StudioField>
  );
}

function countIntelFlags(intel: EditorIntelSettings): { on: number; total: number } {
  let on = 0;
  let total = 0;
  for (const value of Object.values(intel)) {
    if (typeof value !== 'boolean') continue;
    total += 1;
    if (value) on += 1;
  }
  return { on, total };
}

/** Live-applied editor intelligence (lint / hover / complete / marks). */
export const EditorIntelPanel: Component = () => {
  const intel = () => getEditorIntel();
  const set = (partial: Partial<EditorIntelSettings>) => patchEditorIntel(partial);
  const resetFb = useMicrofeedback({ successHoldMs: 700 });
  const flags = () => countIntelFlags(intel());

  return (
    <div class="ax-stack" data-testid="axis-settings-editor-intel">
      <StudioSection
        title="Editor intelligence"
        lead="Pre-eval, hover, completions, underlines, and inline chips. Live apply."
        testId="axis-settings-editor-chrome"
        headerEnd={
          <>
            <span class="ax-chip ax-chip--tag" data-testid="axis-intel-flags-count">
              {flags().on}/{flags().total}
            </span>
            <StudioStatus
              status={intel().preevalEnabled ? 'healthy' : 'idle'}
              label={intel().preevalEnabled ? 'Pre-eval on' : 'Pre-eval off'}
            />
            <StudioStatus
              status={intel().remoteLspEnabled ? 'healthy' : 'idle'}
              label={intel().remoteLspEnabled ? 'Remote LSP' : 'Local only'}
            />
          </>
        }
      >
        <IntelCheck
          id="axis-intel-feature-bar"
          label="Language Feature Bar"
          hint="Chip row above the editor status strip. Click toggles a feature; long-press opens its settings."
          checked={store.editorFeatureBarEnabled}
          onChange={(v) => setEditorFeatureBarEnabled(v)}
        />
        <div class="ax-toolbar">
          <AppButton
            design="soft"
            tone="ghost"
            size="sm"
            testId="axis-settings-editor-reset"
            feedback={resetFb.state()}
            title="Restore factory editor-intelligence defaults"
            onClick={() =>
              void resetFb.run(async () => {
                resetEditorIntel();
              })
            }
          >
            Reset defaults
          </AppButton>
        </div>
        <StudioHint>
          Backend URL for remote LSP lives on Runtime. Problems keep the last marks while typing
          unless “Clear marks while typing” is on.
        </StudioHint>
      </StudioSection>

      <div class="ax-catalog-grid">
        <StudioSection
          title="Pre-eval / lint"
          lead="Idle / Save / Run static checks. Local first; remote merges when Backend URL is set."
        >
          <div class="ax-toggle-grid">
            <IntelCheck
              id="axis-intel-preeval"
              label="Enable pre-eval"
              hint="Parse/lint after idle, Save, and Run. Off skips all static checks."
              checked={intel().preevalEnabled}
              onChange={(v) => set({ preevalEnabled: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-local"
              label="Local structural checks"
              hint="Brackets, strings, missing indicator()/strategy()/library()."
              checked={intel().preevalLocal}
              onChange={(v) => set({ preevalLocal: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-remote"
              label="Remote Pro API diagnostics"
              hint="POST /lsp/diagnostics when Backend URL is set (merged with local)."
              checked={intel().preevalRemote}
              onChange={(v) => set({ preevalRemote: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-typos"
              label="Unknown builtin / typo hints"
              hint="plt() → plot, strategy.etry → strategy.entry (violet, non-blocking)."
              checked={intel().preevalTypos}
              onChange={(v) => set({ preevalTypos: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-version"
              label="Warn if //@version is missing"
              checked={intel().preevalVersionWarn}
              hint="Suggests //@version=6 at the top of the script."
              onChange={(v) => set({ preevalVersionWarn: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-study"
              label="Warn on study()"
              hint="Pine v3 name — use indicator() or strategy()."
              checked={intel().preevalStudyWarn}
              onChange={(v) => set({ preevalStudyWarn: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-security"
              label="Warn on bare security()"
              hint="Prefer request.security (v4+)."
              checked={intel().preevalSecurityWarn}
              onChange={(v) => set({ preevalSecurityWarn: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-dup"
              label="Warn on duplicate declarations"
              hint="Only one indicator() / strategy() / library() per script."
              checked={intel().preevalDuplicateDecl}
              onChange={(v) => set({ preevalDuplicateDecl: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-v6-kwargs"
              label="Warn on v6-removed kwargs"
              hint="strategy.* when= and drawing/plot transp= are ignored in v6 (PYNE W104)."
              checked={intel().preevalV6Kwargs}
              onChange={(v) => set({ preevalV6Kwargs: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-block"
              label="Block Run on errors"
              hint="Severity error disables Run. Typos and warnings never block."
              checked={intel().preevalBlockRun}
              onChange={(v) => set({ preevalBlockRun: v })}
            />
            <IntelCheck
              id="axis-intel-preeval-clear"
              label="Clear marks while typing"
              hint="On: hide underlines and Problems until idle. Off (default): keep the last list until the next check lands."
              checked={intel().preevalClearOnEdit}
              onChange={(v) => set({ preevalClearOnEdit: v })}
            />
          </div>
          <IntelNum
            id="axis-intel-idle-ms"
            label="Idle delay"
            hint="Quiet time after the last keystroke before lint runs"
            value={intel().preevalIdleMs}
            min={INTEL_IDLE_MS_MIN}
            max={INTEL_IDLE_MS_MAX}
            suffix=" ms"
            onChange={(v) => set({ preevalIdleMs: v })}
          />
          <IntelNum
            id="axis-intel-tab-ms"
            label="Tab-switch delay"
            hint="Lint shortly after switching editor tabs"
            value={intel().preevalTabSwitchMs}
            min={INTEL_TAB_SWITCH_MS_MIN}
            max={INTEL_TAB_SWITCH_MS_MAX}
            suffix=" ms"
            onChange={(v) => set({ preevalTabSwitchMs: v })}
          />
        </StudioSection>

        <StudioSection title="Error marking" lead="How diagnostics paint in the buffer and gutter.">
          <div class="ax-toggle-grid">
            <IntelCheck
              id="axis-intel-underlines"
              label="Underlines + line tint"
              hint="Wavy/dotted marks in the buffer."
              checked={intel().diagUnderlines}
              onChange={(v) => set({ diagUnderlines: v })}
            />
            <IntelCheck
              id="axis-intel-gutter"
              label="Gutter markers"
              hint="● / ▲ / ✦ in the left gutter."
              checked={intel().diagGutter}
              onChange={(v) => set({ diagGutter: v })}
            />
            <IntelCheck
              id="axis-intel-diag-hover"
              label="Diagnostic hover"
              hint="Tooltip when the cursor rests on a mark."
              checked={intel().diagHover}
              onChange={(v) => set({ diagHover: v })}
            />
            <IntelCheck
              id="axis-intel-err"
              label="Show errors"
              checked={intel().diagErrors}
              hint="Blocking parse / structural errors."
              onChange={(v) => set({ diagErrors: v })}
            />
            <IntelCheck
              id="axis-intel-warn"
              label="Show warnings"
              checked={intel().diagWarnings}
              hint="study(), missing version, bare security()."
              onChange={(v) => set({ diagWarnings: v })}
            />
            <IntelCheck
              id="axis-intel-typo"
              label="Show typos"
              checked={intel().diagTypos}
              hint="Unknown builtin members (violet)."
              onChange={(v) => set({ diagTypos: v })}
            />
            <IntelCheck
              id="axis-intel-info"
              label="Show info"
              checked={intel().diagInfo}
              hint="Hints and informational engine notes."
              onChange={(v) => set({ diagInfo: v })}
            />
          </div>
        </StudioSection>

        <StudioSection title="Hover cards & hints" lead="Docs and in-call parameter checklist.">
          <div class="ax-toggle-grid">
            <IntelCheck
              id="axis-intel-hover"
              label="Builtin / symbol hover cards"
              hint="Docs for ta.sma, plot, input.*, user annotations."
              checked={intel().hoverEnabled}
              onChange={(v) => set({ hoverEnabled: v })}
            />
            <IntelCheck
              id="axis-intel-hover-remote"
              label="Remote hover"
              hint="Ask Pro API /lsp/hover when local catalog has no card."
              checked={intel().hoverRemote}
              onChange={(v) => set({ hoverRemote: v })}
            />
            <IntelCheck
              id="axis-intel-sig"
              label="Signature / param checklist"
              hint="In-call hint lists every parameter (used / current / unused)."
              checked={intel().signatureHints}
              onChange={(v) => set({ signatureHints: v })}
            />
          </div>
          <IntelNum
            id="axis-intel-hover-ms"
            label="Hover delay"
            hint="How long to rest the pointer before a card opens"
            value={intel().hoverTimeMs}
            min={INTEL_HOVER_MS_MIN}
            max={INTEL_HOVER_MS_MAX}
            step={25}
            suffix=" ms"
            onChange={(v) => set({ hoverTimeMs: v })}
          />
        </StudioSection>

        <StudioSection
          title="Suggestions / autocomplete"
          lead="Typing + ⌘/Ctrl-Space. Named params and enum lists."
        >
          <div class="ax-toggle-grid">
            <IntelCheck
              id="axis-intel-ac"
              label="Enable completions"
              hint="Typing + ⌘/Ctrl-Space. Off removes the list entirely."
              checked={intel().autocompleteEnabled}
              onChange={(v) => set({ autocompleteEnabled: v })}
            />
            <IntelCheck
              id="axis-intel-ac-type"
              label="Activate while typing"
              hint="Off = only open on ⌘/Ctrl-Space."
              checked={intel().activateOnTyping}
              onChange={(v) => set({ activateOnTyping: v })}
            />
            <IntelCheck
              id="axis-intel-ac-params"
              label="Named parameter suggestions"
              hint="After ( or , offer remaining title= / minval= args."
              checked={intel().paramCompletions}
              onChange={(v) => set({ paramCompletions: v })}
            />
            <IntelCheck
              id="axis-intel-ac-enums"
              label="Enum value lists"
              hint="plot.style_*, shape.*, size.*, location.*, color.* after name=."
              checked={intel().enumCompletions}
              onChange={(v) => set({ enumCompletions: v })}
            />
            <IntelCheck
              id="axis-intel-ac-remote"
              label="Remote completions"
              hint="Merge Pro API /lsp/completion when local has no hit."
              checked={intel().remoteCompletions}
              onChange={(v) => set({ remoteCompletions: v })}
            />
          </div>
          <IntelNum
            id="axis-intel-ac-max"
            label="Max rendered options"
            hint="Cap the suggestion popup"
            value={intel().maxRenderedOptions}
            min={INTEL_MAX_OPTIONS_MIN}
            max={INTEL_MAX_OPTIONS_MAX}
            step={8}
            onChange={(v) => set({ maxRenderedOptions: v })}
          />
        </StudioSection>

        <StudioSection
          title="Remote LSP timings"
          lead="Timeouts against Backend URL. Local marks still show while remote waits."
        >
          <IntelCheck
            id="axis-intel-remote-master"
            label="Use remote LSP"
            hint="Master switch for hover / complete / diagnostics against Backend URL."
            checked={intel().remoteLspEnabled}
            onChange={(v) => set({ remoteLspEnabled: v })}
          />
          <div class="ax-token-grid">
            <IntelNum
              id="axis-intel-to-hover"
              label="Hover timeout"
              hint="Give up on /lsp/hover and show local (or nothing)"
              value={intel().hoverTimeoutMs}
              min={INTEL_TIMEOUT_MS_MIN}
              max={INTEL_TIMEOUT_MS_MAX}
              suffix=" ms"
              onChange={(v) => set({ hoverTimeoutMs: v })}
            />
            <IntelNum
              id="axis-intel-to-ac"
              label="Completion timeout"
              hint="Give up on /lsp/completion"
              value={intel().completionTimeoutMs}
              min={INTEL_TIMEOUT_MS_MIN}
              max={INTEL_TIMEOUT_MS_MAX}
              suffix=" ms"
              onChange={(v) => set({ completionTimeoutMs: v })}
            />
            <IntelNum
              id="axis-intel-to-diag"
              label="Diagnostics timeout"
              hint="Local marks already show; this only waits for remote parse"
              value={intel().diagnosticsTimeoutMs}
              min={INTEL_TIMEOUT_MS_MIN}
              max={INTEL_TIMEOUT_MS_MAX}
              suffix=" ms"
              onChange={(v) => set({ diagnosticsTimeoutMs: v })}
            />
          </div>
        </StudioSection>

        <StudioSection title="Inline markers" lead="Color swatches and debug end-of-line chips.">
          <div class="ax-toggle-grid">
            <IntelCheck
              id="axis-intel-color-chips"
              label="Color chips"
              hint="Swatches before hex / color.* tokens."
              checked={intel().colorChips}
              onChange={(v) => set({ colorChips: v })}
            />
            <IntelCheck
              id="axis-intel-inline-chips"
              label="Debug chips (end of line)"
              hint="Also requires the editor Debug toggle. Last-run logs / errors."
              checked={intel().inlineChips}
              onChange={(v) => set({ inlineChips: v })}
            />
            <IntelCheck
              id="axis-intel-pin-gutter"
              label="Debug pin gutter"
              hint="Also requires chart Pins. Lines with bar_index / time."
              checked={intel().inlinePinGutter}
              onChange={(v) => set({ inlinePinGutter: v })}
            />
          </div>
        </StudioSection>
      </div>
    </div>
  );
};

// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wire studio canvas — compose source / stream / engine / storage / dataset.
 * Apply commits the Solid store patch. Does not install plugins.
 *
 * @module ui/wire/WirePage
 */

import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import { Icons } from '../icons';
import { CapabilityBadges } from '../plugin-badges';
import { store } from '../../store';
import { applyArchitecture } from '../architecture/apply';
import {
  PREDEFINITIONS,
  SLOTS,
  configFromActive,
  derivePlan,
  getPlugin,
  pluginKey,
  pluginsFor,
  toStorePatch,
  type AxisConfig,
  type DriftKind,
  type PlanState,
  type Predefinition,
  type SlotKind,
} from '../architecture/plan';
import type { StudioPageId } from '../studio/types';
import {
  StudioButton,
  StudioChip,
  StudioEmpty,
  StudioFooter,
  StudioHint,
} from '../studio';

export function WirePage(props: {
  onClose: () => void;
  onNavigate?: (id: StudioPageId) => void;
  onApplied?: (planName: string) => void;
  onTitle?: (title: string) => void;
}) {
  const [baseId, setBaseId] = createSignal(seedBaseId(seedConfig()));
  const [config, setConfig] = createSignal<AxisConfig>(seedConfig());

  onMount(() => {
    const next = seedConfig();
    setConfig(next);
    setBaseId(seedBaseId(next));
  });

  const plan = createMemo(() => derivePlan(config(), baseId()));

  createEffect(() => {
    const id = plan().base.id;
    if (id !== baseId()) setBaseId(id);
  });

  createEffect(() => {
    props.onTitle?.(`Wire · ${plan().planName}`);
  });

  const selectPredefinition = (preset: Predefinition) => {
    setBaseId(preset.id);
    setConfig(preset.config);
  };

  const changeSlot = (kind: SlotKind, id: string | null) => {
    setConfig((prev) => ({ ...prev, [kind]: id }));
  };

  const reset = () => setConfig(plan().base.config);

  const apply = () => {
    const cfg = { ...config() };
    const result = applyArchitecture(cfg, baseId());
    props.onApplied?.(result.planName);
    props.onClose();
  };

  return (
    <div class="ax-page-stack">
      <div class="ax-page-canvas ax-page-canvas--flush ax-wire-body">
        <aside class="ax-wire-col ax-wire-col--presets">
          <PredefinitionList
            baseId={plan().base.id}
            pristine={plan().pristine}
            config={config()}
            onSelect={selectPredefinition}
          />
        </aside>
        <div class="ax-wire-col ax-wire-col--rail">
          <SlotRail
            config={config()}
            plan={plan()}
            onChange={changeSlot}
            onOpenPlugins={() => props.onNavigate?.('plugins')}
          />
        </div>
        <aside class="ax-wire-col ax-wire-col--plan">
          <PlanSummary config={config()} plan={plan()} />
        </aside>
      </div>
      <StudioFooter
        status={
          plan().pristine ? (
            <>matches {plan().base.name}</>
          ) : (
            <>
              {plan().drifts.length} unsaved slot change
              {plan().drifts.length === 1 ? '' : 's'}
            </>
          )
        }
      >
        <StudioButton
          variant="ghost"
          onClick={reset}
          disabled={plan().pristine}
          title="Reset slots to the current predefinition"
        >
          <Icons.reset />
          Reset
        </StudioButton>
        <StudioButton variant="ghost" onClick={props.onClose}>
          Cancel
        </StudioButton>
        <StudioButton
          variant="primary"
          onClick={apply}
          testId="axis-architecture-apply"
          title={`Apply ${plan().planName}`}
        >
          Apply {plan().planName}
        </StudioButton>
      </StudioFooter>
    </div>
  );
}

function seedConfig(): AxisConfig {
  return configFromActive(store.activePlugins, {
    source: store.source,
    engine: store.engine,
    streamId: store.live?.streamId,
  });
}

function seedBaseId(config: AxisConfig): string {
  return derivePlan(config, PREDEFINITIONS[0]!.id).base.id;
}

const SLOT_ICON: Record<SlotKind, typeof Icons.cpu> = {
  source: Icons.database,
  stream: Icons.radio,
  engine: Icons.cpu,
  storage: Icons.archive,
  dataset: Icons.activity,
};

const DRIFT_ICON: Record<DriftKind, typeof Icons.plus> = {
  added: Icons.plus,
  removed: Icons.minus,
  swapped: Icons.shuffle,
};

function PredefinitionList(props: {
  baseId: string;
  pristine: boolean;
  config: AxisConfig;
  onSelect: (preset: Predefinition) => void;
}) {
  const distance = (preset: Predefinition) =>
    SLOTS.filter((s) => props.config[s.kind] !== preset.config[s.kind]).length;

  return (
    <>
      <div class="ax-wire-col-head">
        <h3 class="ax-section-title">Recipes</h3>
        <span class="ax-card-kicker">{PREDEFINITIONS.length}</span>
      </div>
      <ul class="ax-list ax-wire-preset-list">
        <For each={PREDEFINITIONS}>
          {(preset) => {
            const isBase = () => preset.id === props.baseId;
            const isExact = () => isBase() && props.pristine;
            const delta = () => distance(preset);
            return (
              <li>
                <button
                  type="button"
                  onClick={() => props.onSelect(preset)}
                  aria-current={isExact() ? 'true' : undefined}
                  data-testid={`axis-arch-preset-${preset.id}`}
                  class={`ax-wire-preset ${isBase() ? 'is-base' : ''} ${isExact() ? 'is-exact' : ''}`}
                >
                  <div class="ax-wire-preset-head">
                    <span class="ax-wire-preset-name">{preset.name}</span>
                    <Show when={isExact()}>
                      <span class="ax-status ax-status--healthy">active</span>
                    </Show>
                    <Show when={!isExact() && delta() > 0}>
                      <span class="ax-card-kicker">Δ{delta()}</span>
                    </Show>
                  </div>
                  <p class="ax-wire-preset-tag">{preset.tagline}</p>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
      <p class="ax-hint ax-wire-col-foot">
        Picking a recipe rewires every slot. Change any slot afterwards and the plan name records
        the drift.
      </p>
    </>
  );
}

function SlotRail(props: {
  config: AxisConfig;
  plan: PlanState;
  onChange: (kind: SlotKind, id: string | null) => void;
  onOpenPlugins?: () => void;
}) {
  return (
    <ol class="ax-wire-rail">
      <For each={SLOTS}>
        {(slot, index) => {
          const Icon = SLOT_ICON[slot.kind];
          const options = () => pluginsFor(slot.kind);
          const selected = () => getPlugin(slot.kind, props.config[slot.kind]);
          const drift = () => props.plan.drifts.find((d) => d.kind === slot.kind);
          const isLast = () => index() === SLOTS.length - 1;
          return (
            <li class="ax-wire-slot">
              <div class="ax-wire-spine">
                <span class={`ax-wire-spine-node ${selected() ? 'is-on' : ''}`}>
                  <Icon />
                </span>
                <Show when={!isLast()}>
                  <span
                    class={`ax-wire-spine-line ${selected() ? 'is-on' : ''}`}
                    aria-hidden="true"
                  />
                </Show>
              </div>
              <div>
                <div class="ax-chip-row">
                  <h4 class="ax-label">
                    {slot.label}
                  </h4>
                  <span class="ax-card-kicker">{slot.contract}</span>
                  <Show when={slot.optional}>
                    <span class="ax-chip ax-chip--tag">optional</span>
                  </Show>
                  <Show when={drift()}>
                    {(d) => (
                      <span
                        class={`ax-chip ax-chip--tag ax-ml-auto${
                          d().drift === 'removed' ? ' ax-chip--danger' : ' is-on'
                        }`}
                      >
                        {d().drift}
                      </span>
                    )}
                  </Show>
                </div>
                <StudioHint>{slot.role}</StudioHint>
                <div class="ax-chip-row ax-mt">
                  <Show when={slot.optional}>
                    <StudioChip
                      pressed={props.config[slot.kind] === null}
                      onClick={() => props.onChange(slot.kind, null)}
                    >
                      none
                    </StudioChip>
                  </Show>
                  <For each={options()}>
                    {(plugin) => (
                      <StudioChip
                        pressed={props.config[slot.kind] === plugin.id}
                        testId={`axis-arch-opt-${slot.kind}-${plugin.id}`}
                        onClick={() => props.onChange(slot.kind, plugin.id)}
                      >
                        {plugin.name}
                      </StudioChip>
                    )}
                  </For>
                </div>
                <Show
                  when={selected()}
                  fallback={
                    <div class="ax-mt">
                      <StudioEmpty>Slot empty — resolved as null at runtime.</StudioEmpty>
                      <Show when={props.onOpenPlugins}>
                        <StudioButton variant="ghost" onClick={() => props.onOpenPlugins?.()}>
                          Open Plugins
                        </StudioButton>
                      </Show>
                    </div>
                  }
                >
                  {(plugin) => (
                    <div class="ax-mt">
                      <p class="ax-hint ax-hint--accent">
                        {pluginKey(slot.kind, plugin().id)}
                      </p>
                      <StudioHint>{plugin().description}</StudioHint>
                      <CapabilityBadges
                        capabilities={plugin().capabilities}
                        kind={plugin().kind}
                        compact
                      />
                    </div>
                  )}
                </Show>
              </div>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

function PlanSummary(props: { config: AxisConfig; plan: PlanState }) {
  const patch = () => toStorePatch(props.config);
  const req = () => props.plan.requirements;

  return (
    <div>
      <section class="ax-section ax-wire-block--tight">
        <h3 class="ax-section-title">Plan</h3>
        <div class="ax-chip-row">
          <span class="ax-wire-preset-name">{props.plan.base.name}</span>
          <Show
            when={props.plan.pristine}
            fallback={
              <span class="ax-chip-row">
                <Show when={props.plan.added + props.plan.swapped > 0}>
                  <span class="ax-chip is-on">+{props.plan.added + props.plan.swapped}</span>
                </Show>
                <Show when={props.plan.removed > 0}>
                  <span class="ax-chip ax-chip--danger">
                    −{props.plan.removed}
                  </span>
                </Show>
              </span>
            }
          >
            <span class="ax-status ax-status--healthy">exact</span>
          </Show>
        </div>
        <StudioHint>
          <Show
            when={props.plan.pristine}
            fallback={
              <>
                Derived from {props.plan.base.name} with {props.plan.drifts.length} slot
                {props.plan.drifts.length === 1 ? '' : 's'} changed.
              </>
            }
          >
            {props.plan.base.tagline}
          </Show>
        </StudioHint>
      </section>

      <section class="ax-section ax-wire-block">
        <h3 class="ax-section-title">Requirements</h3>
        <div class="ax-chip-row">
          <Show
            when={req().fullyOffline}
            fallback={
              <span class="ax-chip">
                <Icons.wifi /> network required
              </span>
            }
          >
            <span class="ax-chip is-on">
              <Icons.wifiOff /> runs fully offline
            </span>
          </Show>
          <Show when={req().needsProxy}>
            <span class="ax-chip">
              <Icons.shuffle /> worker proxy
            </span>
          </Show>
          <Show when={req().needsAuth}>
            <span class="ax-chip">
              <Icons.key /> credentials
            </span>
          </Show>
        </div>
      </section>

      <section class="ax-section ax-wire-block--end">
        <h3 class="ax-section-title">Diff</h3>
        <Show
          when={props.plan.drifts.length > 0}
          fallback={
            <StudioEmpty>No changes against {props.plan.base.name}</StudioEmpty>
          }
        >
          <ul class="ax-list">
            <For each={props.plan.drifts}>
              {(d) => {
                const Icon = DRIFT_ICON[d.drift];
                return (
                  <li class="ax-row">
                    <Icon />
                    <div>
                      <p class="ax-label">{d.label}</p>
                      <p class="ax-hint">
                        <s>{d.from?.id ?? 'none'}</s>
                        {' → '}
                        {d.to?.id ?? 'none'}
                      </p>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>

      <section class="ax-section ax-wire-block--end">
        <h3 class="ax-section-title">Store patch</h3>
        <pre class="ax-wire-patch" data-testid="axis-architecture-patch">
          <code>{JSON.stringify(patch(), null, 2)}</code>
        </pre>
      </section>
    </div>
  );
}

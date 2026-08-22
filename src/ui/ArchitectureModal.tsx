// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Architecture modal — start from a compose-recipe predefinition, then swap
 * or switch off any plugin slot. Apply commits the Solid store patch.
 *
 * @module ui/ArchitectureModal
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from 'solid-js';
import { Icons } from './icons';
import { AppDrawer } from './AppDrawer';
import { CapabilityBadges } from './plugin-badges';
import { store } from '../store';
import { applyArchitecture } from './architecture/apply';
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
} from './architecture/plan';

export interface ArchitectureModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful apply (parent may bump catalogTick). */
  onApplied?: (planName: string) => void;
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

/** Modal: wire source / stream / engine / storage / dataset from recipes. */
export const ArchitectureModal: Component<ArchitectureModalProps> = (props) => {
  const [baseId, setBaseId] = createSignal(seedBaseId(seedConfig()));
  const [config, setConfig] = createSignal<AxisConfig>(seedConfig());

  createEffect(() => {
    if (!props.open) return;
    untrack(() => {
      const next = seedConfig();
      setConfig(next);
      setBaseId(seedBaseId(next));
    });
  });

  const plan = createMemo(() => derivePlan(config(), baseId()));

  createEffect(() => {
    const id = plan().base.id;
    if (id !== baseId()) setBaseId(id);
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
    const result = applyArchitecture(config(), baseId());
    props.onApplied?.(result.planName);
    props.onClose();
  };

  return (
    <AppDrawer
      open={props.open}
      onClose={props.onClose}
      title={`Wire · ${plan().planName}`}
      titleId="axis-architecture-title"
      hint="Start from a recipe, then swap any slot. Plugins share one contract."
      testId="axis-architecture-modal"
      closeTestId="axis-architecture-close"
      width="xl"
      flush
      panelClass="axis-arch-dialog"
      headerRight={
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-2"
                onClick={reset}
                disabled={plan().pristine}
                title="Reset slots to the current predefinition"
              >
                <Icons.reset />
                <span class="axis-tb-btn-label">Reset</span>
              </button>
      }
      footer={
        <>
            <p class="sc-hint font-mono m-0 flex-1">
              <Show
                when={plan().pristine}
                fallback={
                  <>
                    <span class="text-accent">●</span> {plan().drifts.length} unsaved
                    slot change{plan().drifts.length === 1 ? '' : 's'}
                  </>
                }
              >
                <span class="text-accent-2">●</span> matches {plan().base.name}
              </Show>
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="sc-btn sc-btn-ghost"
                onClick={() => props.onClose()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-primary max-w-[16rem]"
                onClick={apply}
                data-testid="axis-architecture-apply"
                title={`Apply ${plan().planName}`}
              >
                <span class="truncate">Apply {plan().planName}</span>
              </button>
            </div>
        </>
      }
    >
          <div class="axis-arch-body">
            <aside class="axis-arch-col axis-arch-col--presets">
              <PredefinitionList
                baseId={plan().base.id}
                pristine={plan().pristine}
                config={config()}
                onSelect={selectPredefinition}
              />
            </aside>

            <div class="axis-arch-col axis-arch-col--rail">
              <SlotRail config={config()} plan={plan()} onChange={changeSlot} />
            </div>

            <aside class="axis-arch-col axis-arch-col--plan">
              <PlanSummary config={config()} plan={plan()} />
            </aside>
          </div>
    </AppDrawer>
  );
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
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-baseline justify-between px-3 pb-2">
        <h3 class="sc-section-title m-0">Predefinitions</h3>
        <span class="sc-hint font-mono">{PREDEFINITIONS.length}</span>
      </div>
      <ul class="flex flex-col gap-px overflow-y-auto min-h-0 m-0 p-0 list-none">
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
                  class={`axis-arch-preset ${isBase() ? 'is-base' : ''} ${isExact() ? 'is-exact' : ''}`}
                >
                  <span class="axis-arch-preset-rail" aria-hidden="true" />
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[13px] font-medium text-text">{preset.name}</span>
                    <Show when={isExact()}>
                      <span class="font-mono text-[10px] text-accent">active</span>
                    </Show>
                    <Show when={!isExact() && delta() > 0}>
                      <span class="font-mono text-[10px] text-text-faint tabular-nums">
                        Δ{delta()}
                      </span>
                    </Show>
                  </div>
                  <p class="m-0 mt-0.5 text-[11px] leading-snug text-text-dim">
                    {preset.tagline}
                  </p>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
      <p class="sc-hint px-3 pt-3 mt-auto">
        Picking a predefinition rewires every slot at once. Change any slot
        afterwards and the plan name records the drift.
      </p>
    </div>
  );
}

function SlotRail(props: {
  config: AxisConfig;
  plan: PlanState;
  onChange: (kind: SlotKind, id: string | null) => void;
}) {
  return (
    <ol class="axis-arch-rail m-0 p-0 list-none">
      <For each={SLOTS}>
        {(slot, index) => {
          const Icon = SLOT_ICON[slot.kind];
          const options = () => pluginsFor(slot.kind);
          const selected = () => getPlugin(slot.kind, props.config[slot.kind]);
          const drift = () => props.plan.drifts.find((d) => d.kind === slot.kind);
          const isLast = () => index() === SLOTS.length - 1;
          return (
            <li class="axis-arch-slot">
              <div class="axis-arch-spine">
                <span
                  class={`axis-arch-spine-node ${selected() ? 'is-on' : ''}`}
                >
                  <Icon />
                </span>
                <Show when={!isLast()}>
                  <span
                    class={`axis-arch-spine-line ${selected() ? 'is-on' : ''}`}
                    aria-hidden="true"
                  />
                </Show>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h4 class="m-0 font-mono text-[11px] tracking-[0.14em] uppercase text-text">
                    {slot.label}
                  </h4>
                  <span class="font-mono text-[10px] text-text-faint">
                    {slot.contract}
                  </span>
                  <Show when={slot.optional}>
                    <span class="axis-arch-pill">optional</span>
                  </Show>
                  <Show when={drift()}>
                    {(d) => {
                      const DriftIcon = DRIFT_ICON[d().drift];
                      return (
                        <span
                          class={`ml-auto inline-flex items-center gap-1 font-mono text-[10px] ${
                            d().drift === 'removed' ? 'text-red' : 'text-accent'
                          }`}
                        >
                          <DriftIcon />
                          {d().drift}
                        </span>
                      );
                    }}
                  </Show>
                </div>
                <p class="m-0 mt-0.5 text-[11px] text-text-faint">{slot.role}</p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <Show when={slot.optional}>
                    <button
                      type="button"
                      class={`axis-arch-opt font-mono ${
                        props.config[slot.kind] === null ? 'is-on' : ''
                      }`}
                      aria-pressed={props.config[slot.kind] === null}
                      onClick={() => props.onChange(slot.kind, null)}
                    >
                      none
                    </button>
                  </Show>
                  <For each={options()}>
                    {(plugin) => (
                      <button
                        type="button"
                        class={`axis-arch-opt ${
                          props.config[slot.kind] === plugin.id ? 'is-on' : ''
                        }`}
                        aria-pressed={props.config[slot.kind] === plugin.id}
                        data-testid={`axis-arch-opt-${slot.kind}-${plugin.id}`}
                        onClick={() => props.onChange(slot.kind, plugin.id)}
                      >
                        {plugin.name}
                      </button>
                    )}
                  </For>
                </div>
                <div class="mt-2 border-l border-border/70 pl-3">
                  <Show
                    when={selected()}
                    fallback={
                      <p class="m-0 font-mono text-[10px] text-text-faint">
                        slot empty — resolved as null at runtime
                      </p>
                    }
                  >
                    {(plugin) => (
                      <>
                        <p class="m-0 font-mono text-[10px] text-accent">
                          {pluginKey(slot.kind, plugin().id)}
                        </p>
                        <p class="m-0 mt-1 text-[11px] leading-snug text-text-dim">
                          {plugin().description}
                        </p>
                        <CapabilityBadges
                          capabilities={plugin().capabilities}
                          kind={plugin().kind}
                          compact
                        />
                      </>
                    )}
                  </Show>
                </div>
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
    <div class="flex flex-col">
      <section class="axis-arch-section">
        <h3 class="sc-section-title">Plan</h3>
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="text-[1.05em] font-semibold tracking-tight text-text">
            {props.plan.base.name}
          </span>
          <Show
            when={props.plan.pristine}
            fallback={
              <span class="flex items-center gap-1">
                <Show when={props.plan.added + props.plan.swapped > 0}>
                  <span class="axis-arch-delta axis-arch-delta--plus">
                    +{props.plan.added + props.plan.swapped}
                  </span>
                </Show>
                <Show when={props.plan.removed > 0}>
                  <span class="axis-arch-delta axis-arch-delta--minus">
                    −{props.plan.removed}
                  </span>
                </Show>
              </span>
            }
          >
            <span class="inline-flex items-center gap-1 font-mono text-[10px] text-accent-2">
              <Icons.check />
              exact
            </span>
          </Show>
        </div>
        <p class="m-0 mt-1.5 text-[11px] leading-snug text-text-dim">
          <Show
            when={props.plan.pristine}
            fallback={
              <>
                Derived from <span class="text-text">{props.plan.base.name}</span>{' '}
                with {props.plan.drifts.length} slot
                {props.plan.drifts.length === 1 ? '' : 's'} changed. Reset, or keep
                drifting until it lands on another predefinition.
              </>
            }
          >
            {props.plan.base.tagline}
          </Show>
        </p>
      </section>

      <section class="axis-arch-section">
        <h3 class="sc-section-title">Requirements</h3>
        <div class="flex flex-wrap gap-1">
          <Show
            when={req().fullyOffline}
            fallback={
              <span class="axis-arch-chip axis-arch-chip--warn">
                <Icons.wifi /> network required
              </span>
            }
          >
            <span class="axis-arch-chip axis-arch-chip--safe">
              <Icons.wifiOff /> runs fully offline
            </span>
          </Show>
          <Show when={req().needsProxy}>
            <span class="axis-arch-chip axis-arch-chip--warn">
              <Icons.shuffle /> worker proxy
            </span>
          </Show>
          <Show when={req().needsAuth}>
            <span class="axis-arch-chip axis-arch-chip--alert">
              <Icons.key /> credentials
            </span>
          </Show>
        </div>
      </section>

      <section class="axis-arch-section">
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="sc-section-title m-0">Diff</h3>
          <span class="font-mono text-[10px] text-text-faint tabular-nums">
            {props.plan.drifts.length} / {SLOTS.length} slots
          </span>
        </div>
        <Show
          when={props.plan.drifts.length > 0}
          fallback={
            <p class="m-0 mt-2 font-mono text-[10px] text-text-faint">
              no changes against {props.plan.base.name}
            </p>
          }
        >
          <ul class="m-0 mt-2 p-0 list-none flex flex-col gap-2">
            <For each={props.plan.drifts}>
              {(d) => {
                const Icon = DRIFT_ICON[d.drift];
                return (
                  <li class="flex gap-2">
                    <Icon
                      class={d.drift === 'removed' ? 'text-red mt-0.5' : 'text-accent mt-0.5'}
                    />
                    <div class="min-w-0 flex-1">
                      <p class="m-0 font-mono text-[10px] tracking-wide uppercase text-text-dim">
                        {d.label}
                      </p>
                      <p class="m-0 flex flex-wrap items-center gap-1 font-mono text-[10px]">
                        <span class="text-text-faint line-through">
                          {d.from?.id ?? 'none'}
                        </span>
                        <Icons.arrowRight class="text-text-faint" />
                        <span class={d.to ? 'text-accent' : 'text-red'}>
                          {d.to?.id ?? 'none'}
                        </span>
                      </p>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>

      <section class="axis-arch-section">
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="sc-section-title m-0">Store patch</h3>
          <span class="font-mono text-[10px] text-text-faint">solid</span>
        </div>
        <pre
          class="axis-arch-patch"
          data-testid="axis-architecture-patch"
        >
          <code>{JSON.stringify(patch(), null, 2)}</code>
        </pre>
      </section>
    </div>
  );
}

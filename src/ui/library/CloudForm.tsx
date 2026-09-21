// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cloud storage credentials shown when the personal library backend is `cloud`.
 *
 * @module ui/library/CloudForm
 */

import type { Component } from 'solid-js';
import { LibraryField } from './Field';

export const CloudSettingsForm: Component<{
  endpoint: string;
  apiKey: string;
  onEndpoint: (value: string) => void;
  onApiKey: (value: string) => void;
  onGenerate: () => void;
  onTest: () => void;
  onSave: () => void;
}> = (props) => (
  <div class="border border-border p-2 flex flex-col gap-2 bg-bg-elev rounded-md">
    <div class="text-[10px] text-text-dim uppercase tracking-wider">Cloud credentials</div>
    <LibraryField label="Worker URL">
      <input
        class="sc-input font-mono text-[11px]"
        placeholder="https://…"
        value={props.endpoint}
        onInput={(e) => props.onEndpoint(e.currentTarget.value)}
        spellcheck={false}
        autocomplete="off"
      />
    </LibraryField>
    <LibraryField label="API key">
      <input
        class="sc-input font-mono text-[11px]"
        placeholder="pn_…"
        type="password"
        value={props.apiKey}
        onInput={(e) => props.onApiKey(e.currentTarget.value)}
        spellcheck={false}
        autocomplete="off"
      />
    </LibraryField>
    <div class="flex flex-wrap gap-1.5">
      <button type="button" class="sc-btn sc-btn-ghost text-[10px]" onClick={props.onGenerate}>
        Generate demo key
      </button>
      <button type="button" class="sc-btn sc-btn-ghost text-[10px]" onClick={props.onTest}>
        Test connection
      </button>
      <button type="button" class="sc-btn sc-btn-ghost text-[10px]" onClick={props.onSave}>
        Save cloud settings
      </button>
    </div>
  </div>
);

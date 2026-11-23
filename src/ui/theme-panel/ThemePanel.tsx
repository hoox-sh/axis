// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart Theme Manager — presets, saved themes, and per-token editors.
 *
 * The shell does not read the store. Preset state stays in {@link PresetColumn};
 * each token control reads its own value.
 *
 * @module ui/theme-panel/ThemePanel
 */

import { PresetColumn } from './PresetColumn';
import { TokenGroups } from './TokenGroups';

/** Props for the theme editor: `compact` tightens spacing for the Settings embed. */
export interface ThemePanelProps {
  /** Compact spacing for Settings embed. */
  compact?: boolean;
}

/** Full chart theme editor (presets + grouped tokens). */
export const ThemePanel = (props: ThemePanelProps): JSX.Element => {
  return (
    <div
      class={`ax-split ax-theme-panel${props.compact ? ' ax-stack--compact' : ''}`}
      data-testid="axis-theme-panel"
    >
      <PresetColumn />
      <TokenGroups />
    </div>
  );
};

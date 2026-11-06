// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Query-match highlighting for library card titles and descriptions.
 *
 * @module ui/library/highlight
 */

import { For, type JSX } from 'solid-js';
import { splitHighlight } from './format';

/**
 * Render `text` with every query term wrapped in `<mark>` for the library
 * search hits. Splitting comes from {@link splitHighlight}.
 *
 * @param props - Text to render and the raw search query.
 * @returns Alternating plain strings and `<mark>` elements.
 */
export function Highlight(props: { text: string; query?: string }): JSX.Element {
  return (
    <For each={splitHighlight(props.text, props.query ?? '')}>
      {(part) => (part.match ? <mark class="ax-library-hl">{part.text}</mark> : part.text)}
    </For>
  );
}

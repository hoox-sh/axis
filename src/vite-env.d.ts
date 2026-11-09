/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/// <reference types="vite/client" />

/**
 * Global `JSX` namespace for `jsx: "preserve"` builds.
 *
 * With `jsxImportSource: "solid-js"` TypeScript resolves JSX types at usage
 * sites, but a bare `JSX.Element` annotation is not a usage site, so the
 * namespace has to exist in the global scope. Every member mirrors
 * `solid-js.JSX` exactly — this is a type-only re-export, nothing is emitted.
 */
declare namespace JSX {
  type Element = import('solid-js').JSX.Element;
  type ElementClass = import('solid-js').JSX.ElementClass;
  type ElementAttributesProperty = import('solid-js').JSX.ElementAttributesProperty;
  type ElementChildrenAttribute = import('solid-js').JSX.ElementChildrenAttribute;
  type IntrinsicAttributes = import('solid-js').JSX.IntrinsicAttributes;
  type IntrinsicElements = import('solid-js').JSX.IntrinsicElements;
}

interface ImportMetaEnv {
  readonly VITE_AXIS_DEBUG?: string;
  readonly VITE_DEBUG?: string;
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_PYNE_API?: string;
  readonly VITE_ALLOW_REMOTE_PLUGINS?: string;
  readonly VITE_PLUGIN_REMOTE_ALLOW?: string;
}

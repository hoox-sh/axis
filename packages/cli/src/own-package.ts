/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Own package metadata, embedded at bundle/compile time.
 *
 * Reading `../package.json` from disk breaks in the standalone binary
 * (`bun build --compile`): there is no package.json next to the bundled code
 * (import.meta.url points into the virtual $bunfs). A static import makes
 * bun bundle it into dist/ and embed it into compiled executables, so
 * `axis --version`, preflight, and the doctor CLI row work in every mode:
 * bun src → node dist → single-file binary.
 */
import ownPackageJson from '../package.json';

/**
 * Shape of `@hoox-sh/axis-cli`'s own `package.json`, narrowed to the fields the
 * CLI reads at runtime.
 *
 * Bundled rather than read from disk so it survives `bun build --compile`.
 */
export type OwnPackage = {
  version: string;
  engines?: Record<string, string>;
  name?: string;
};

/**
 * The CLI's own package metadata, embedded by the bundler at build time.
 *
 * Source of `axis --version`, the preflight engine check, and the doctor CLI row —
 * safe to read in bun, node, and single-file binary modes.
 */
export const ownPackage: OwnPackage = ownPackageJson as OwnPackage;

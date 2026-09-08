/**
 * Copyright (C) 2024-2026 jango_blockchained
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
import ownPackageJson from "../package.json";

export type OwnPackage = {
  version: string;
  engines?: Record<string, string>;
  name?: string;
};

export const ownPackage: OwnPackage = ownPackageJson as OwnPackage;

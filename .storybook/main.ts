/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StorybookConfig } from 'storybook-solidjs-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: 'storybook-solidjs-vite',
    options: {},
  },
  staticDirs: ['../public'],
  viteFinal: async (config) => {
    // lucide-solid's `solid` export condition points at raw .jsx source
    // (hundreds of modules) which stalls storybook's Vite transform.
    // Point the barrel at the prebuilt ESM bundle instead.
    const path = await import('node:path');
    const entry = path.resolve(
      process.cwd(),
      'node_modules/lucide-solid/dist/esm/lucide-solid.mjs',
    );
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string> | undefined),
      'lucide-solid': entry,
    };
    return config;
  },
};

export default config;

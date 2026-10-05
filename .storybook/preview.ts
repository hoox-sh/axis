/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Preview } from 'storybook-solidjs-vite';
import '../src/index.css';
import './preview.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'void',
      values: [
        { name: 'void', value: '#07080C' },
        { name: 'panel', value: '#0C0E14' },
        { name: 'elev', value: '#10131B' },
        { name: 'light', value: '#F3F4F8' },
      ],
    },
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default preview;

/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { TopbarField } from '../ui/TopbarField';

const meta: Meta<typeof TopbarField> = {
  title: 'Chrome/TopbarField',
  component: TopbarField,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Mono text field as used for the topbar symbol. */
export const SymbolInput: Story = {
  args: { label: 'Symbol', mono: true, value: 'BTCUSDT', placeholder: 'BTCUSDT' },
};

/** Select variant holding the interval options. */
export const IntervalSelect: Story = {
  args: { label: 'Interval', variant: 'select', value: '1h' },
  render: () => (
    <TopbarField label="Interval" variant="select" value="1h">
      <option value="1m">1m</option>
      <option value="5m">5m</option>
      <option value="1h">1h</option>
      <option value="1D">1D</option>
    </TopbarField>
  ),
};

/** Read-only static value (venue label). */
export const Static: Story = {
  args: { label: 'Source', variant: 'static', children: 'Binance · WS' },
};

/** Disabled text field. */
export const Disabled: Story = {
  args: { label: 'Symbol', disabled: true, value: 'BTCUSDT' },
};

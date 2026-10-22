// Throwaway: regenerate tests/hp/axb1-vectors.json golden hex from the AXIS encoder.
/* eslint-disable */
import { writeFileSync } from 'node:fs';
import { Axb1Opcode, TipMask, ValueKind } from '../src/hp/axb1/constants';
import { encodeFrame } from '../src/hp/axb1/encode';
import { bytesToHex } from '../src/hp/axb1/decode';
import { fnv1a32 } from '../src/hp/axb1/hash';
import type { Axb1Frame } from '../src/hp/axb1/types';

const SERIES_ID = 'series:binance|spot|BTC/USDT|1m';
const PLOT_KEY = 'ema20';
const SESSION_ID = 'sess-7f3a';

const subHash = fnv1a32(SERIES_ID);
const plotHash = fnv1a32(PLOT_KEY);
const sessionHash = fnv1a32(SESSION_ID);

const MASK_BITS: Record<string, number> = {
  OPEN: TipMask.OPEN,
  HIGH: TipMask.HIGH,
  LOW: TipMask.LOW,
  CLOSE: TipMask.CLOSE,
  VOLUME: TipMask.VOLUME,
  TIME: TipMask.TIME,
};

function maskOf(names: string[]): number {
  return names.reduce((m, n) => m | (MASK_BITS[n] ?? 0), 0);
}

function tipOf(t: Record<string, unknown>) {
  return {
    mask: maskOf(t.mask as string[]),
    flags: t.flags as number,
    timeS: t.time_s as number | undefined,
    open: t.open != null ? BigInt(t.open as string) : undefined,
    high: t.high != null ? BigInt(t.high as string) : undefined,
    low: t.low != null ? BigInt(t.low as string) : undefined,
    close: t.close != null ? BigInt(t.close as string) : undefined,
    volume: t.volume as number | undefined,
  };
}

function toFrame(f: Record<string, unknown>): Axb1Frame {
  const header = {
    seq: f.seq as number,
    subIdHash: f.sub_id_hash as number,
    sessionHash: f.session_hash as number,
    tsMs: BigInt(f.ts_ms as string),
    hdrFlags: (f.hdr_flags as number) ?? 0,
  };
  const r = { ...f };
  delete r.opcode;
  delete r.seq;
  delete r.sub_id_hash;
  delete r.session_hash;
  delete r.ts_ms;
  delete r.hdr_flags;
  switch (f.opcode) {
    case 'HEARTBEAT':
      return { opcode: Axb1Opcode.HEARTBEAT, ...header };
    case 'UNCHANGED':
      return { opcode: Axb1Opcode.UNCHANGED, ...header };
    case 'STATUS':
      return {
        opcode: Axb1Opcode.STATUS,
        ...header,
        statusCode: r.status_code as string,
        detail: r.detail as string,
        have: r.have as number,
        need: r.need as number,
      };
    case 'TIP_UPDATE':
      return { opcode: Axb1Opcode.TIP_UPDATE, ...header, ...tipOf(r) };
    case 'APPEND_BAR':
      return {
        opcode: Axb1Opcode.APPEND_BAR,
        ...header,
        priceScale: r.price_scale as number,
        closedIndex: r.closed_index as number,
        closedTime: r.closed_time as number,
        open: BigInt(r.open as string),
        high: BigInt(r.high as string),
        low: BigInt(r.low as string),
        close: BigInt(r.close as string),
        volume: r.volume as number,
        tip: tipOf(r.tip as Record<string, unknown>),
      };
    case 'CLOSE_VERIFY':
      return {
        opcode: Axb1Opcode.CLOSE_VERIFY,
        ...header,
        index: r.index as number,
        timeS: r.time_s as number,
        open: BigInt(r.open as string),
        high: BigInt(r.high as string),
        low: BigInt(r.low as string),
        close: BigInt(r.close as string),
        volume: r.volume as number,
      };
    case 'PLOT_TIP':
      return {
        opcode: Axb1Opcode.PLOT_TIP,
        ...header,
        plots: (r.plots as Array<Record<string, unknown>>).map((p) => ({
          keyHash: p.key_hash as number,
          kind: p.kind === 'price_ticks' ? ValueKind.PriceTicks : ValueKind.UnitFloat64,
          ticks: p.ticks != null ? BigInt(p.ticks as string) : undefined,
          value: p.value as number | undefined,
        })),
      };
    case 'SNAPSHOT_OHLCV':
      return {
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        ...header,
        priceScale: r.price_scale as number,
        count: r.count as number,
        closedUpto: r.closed_upto as number,
        hotFromIndex: r.hot_from_index as number,
        timeS: r.time_s as number[],
        open: (r.open as string[]).map(BigInt),
        high: (r.high as string[]).map(BigInt),
        low: (r.low as string[]).map(BigInt),
        close: (r.close as string[]).map(BigInt),
        volume: r.volume as number[],
        flags: r.flags as number[],
      };
    case 'SNAPSHOT_PLOTS':
      return {
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        ...header,
        count: r.count as number,
        closedUpto: r.closed_upto as number,
        times: r.times as number[] | null,
        plots: (r.plots as Array<Record<string, unknown>>).map((col) => ({
          key: col.key as string,
          kind: col.kind === 'price_ticks' ? ValueKind.PriceTicks : ValueKind.UnitFloat64,
          ticks: col.ticks != null ? (col.ticks as string[]).map(BigInt) : undefined,
          values: col.values as number[] | undefined,
        })),
      };
    case 'ERROR':
      return {
        opcode: Axb1Opcode.ERROR,
        ...header,
        code: r.code as string,
        message: r.message as string,
        retryable: r.retryable as boolean,
      };
    case 'JSON_BLOB':
      return {
        opcode: Axb1Opcode.JSON_BLOB,
        ...header,
        json: r.json as string,
      };
    default:
      throw new Error(`unknown opcode ${String(f.opcode)}`);
  }
}

const T0 = 1_760_000_000;
const OHLC_TICKS = {
  open: '6042300000000',
  high: '6042900000000',
  low: '6042100000000',
  close: '6042500000000',
};

const specs: Array<{ name: string; frame: Record<string, unknown> }> = [
  {
    name: 'heartbeat',
    frame: {
      opcode: 'HEARTBEAT',
      seq: 0,
      sub_id_hash: 0,
      session_hash: 0,
      ts_ms: '0',
    },
  },
  {
    name: 'unchanged',
    frame: {
      opcode: 'UNCHANGED',
      seq: 9,
      sub_id_hash: subHash,
      session_hash: 0,
      ts_ms: '1760000000123',
    },
  },
  {
    name: 'status-live',
    frame: {
      opcode: 'STATUS',
      seq: 3,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000050',
      status_code: 'live',
      detail: 'live/1 ok',
      have: 5000,
      need: 5000,
    },
  },
  {
    name: 'tip-close-volume',
    frame: {
      opcode: 'TIP_UPDATE',
      seq: 12,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000310',
      mask: ['CLOSE', 'VOLUME', 'TIME'],
      flags: 1,
      close: '6042550000000',
      volume: 12.5,
      time_s: T0 + 60,
    },
  },
  {
    name: 'tip-full-ohlcv',
    frame: {
      opcode: 'TIP_UPDATE',
      seq: 13,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000330',
      mask: ['OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME', 'TIME'],
      flags: 1,
      ...OHLC_TICKS,
      volume: 13.25,
      time_s: T0 + 60,
    },
  },
  {
    name: 'append-bar',
    frame: {
      opcode: 'APPEND_BAR',
      seq: 42,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000060010',
      price_scale: 8,
      closed_index: 41,
      closed_time: T0,
      ...OHLC_TICKS,
      volume: 11.75,
      tip: {
        mask: ['CLOSE', 'VOLUME', 'TIME'],
        flags: 1,
        close: '6042550000000',
        volume: 2.5,
        time_s: T0 + 60,
      },
    },
  },
  {
    name: 'close-verify',
    frame: {
      opcode: 'CLOSE_VERIFY',
      seq: 43,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000060011',
      index: 41,
      time_s: T0,
      ...OHLC_TICKS,
      volume: 11.75,
    },
  },
  {
    name: 'plot-tip',
    frame: {
      opcode: 'PLOT_TIP',
      seq: 14,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000340',
      plots: [
        { key_hash: plotHash, kind: 'price_ticks', ticks: '6042400000000' },
        { key_hash: fnv1a32('rsi14'), kind: 'unit_float64', value: 61.5 },
      ],
    },
  },
  {
    name: 'snapshot-ohlcv-2bar',
    frame: {
      opcode: 'SNAPSHOT_OHLCV',
      seq: 1,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000001',
      price_scale: 8,
      count: 2,
      closed_upto: 0,
      hot_from_index: 0,
      time_s: [T0 - 60, T0],
      open: ['6041900000000', '6042300000000'],
      high: ['6042400000000', '6042900000000'],
      low: ['6041800000000', '6042100000000'],
      close: ['6042300000000', '6042500000000'],
      volume: [10.5, 1.5],
      flags: [1, 2],
    },
  },
  {
    name: 'snapshot-plots',
    frame: {
      opcode: 'SNAPSHOT_PLOTS',
      seq: 2,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000002',
      count: 2,
      closed_upto: 1,
      times: [T0 - 60, T0],
      plots: [{ key: PLOT_KEY, kind: 'unit_float64', values: [60420.5, 60423.75] }],
    },
  },
  {
    name: 'error-repair',
    frame: {
      opcode: 'ERROR',
      seq: 5,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000900',
      code: 'REPAIR',
      message: 'gap at seq 4',
      retryable: true,
    },
  },
  {
    name: 'json-blob',
    frame: {
      opcode: 'JSON_BLOB',
      seq: 6,
      sub_id_hash: subHash,
      session_hash: sessionHash,
      ts_ms: '1760000000950',
      json: '{"drawings":[]}',
    },
  },
];

const out = {
  version: 1,
  comment:
    'Golden AXB1 envelopes shared with PYNE (pyne: tests/data/axb1-vectors.json, regenerate there from this file). ' +
    'Each vector carries the language-neutral frame spec (int64/uint64 as decimal strings) and the exact little-endian hex ' +
    'the encoder must emit. Regenerate hex with: bun scripts/generate-axb1-vectors.ts (axis repo).',
  hash_checks: [
    { input: SERIES_ID, fnv1a32: subHash },
    { input: PLOT_KEY, fnv1a32: plotHash },
    { input: SESSION_ID, fnv1a32: sessionHash },
  ],
  vectors: specs.map(({ name, frame }) => ({
    name,
    frame,
    hex: bytesToHex(encodeFrame(toFrame(frame))),
  })),
};

writeFileSync('tests/hp/axb1-vectors.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `wrote ${out.vectors.length} vectors; subHash=${subHash} plotHash=${plotHash} sessionHash=${sessionHash}`,
);

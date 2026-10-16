import { describe, expect, test } from 'bun:test';
import {
  Redesign2WsClient,
  endpointToRedesign2WsUrl,
} from '../../src/engine/ws-client';

describe('redesign2 websocket transport', () => {
  test('maps an HTTP endpoint to the pinned /ws/live URL', () => {
    expect(endpointToRedesign2WsUrl('https://pynescript.online/api')).toBe(
      'wss://pynescript.online/ws/live',
    );
    expect(endpointToRedesign2WsUrl('http://127.0.0.1:5002')).toBe(
      'ws://127.0.0.1:5002/ws/live',
    );
  });

  test('constructs without opening a socket', () => {
    const client = new Redesign2WsClient({ endpoint: 'https://pynescript.online' });
    expect(client.urlValue).toBe('wss://pynescript.online/ws/live');
    expect(client.isOpen).toBe(false);
  });
});
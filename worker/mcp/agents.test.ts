import { describe, expect, test } from 'vitest';
import { describeDevice, noteAgentUse, returnsTo } from './agents';

// Telling one agent connection from another in Settings: where the app carries on once
// let in, and the browser and device it was let in from

describe('where an agent carries on once let in', () => {
  test.each([
    ['https://claude.ai/api/mcp/auth_callback', { site: 'claude.ai' }],
    ['http://localhost:51234/callback', { computer: true }],
    ['http://127.0.0.1:9/callback', { computer: true }],
    ['http://[::1]:8080/cb', { computer: true }],
    ['cursor://anysphere.cursor-retrieval/oauth/callback', { computer: true }],
    [undefined, null],
    ['not a url', null],
  ])('%s', (uri, expected) => {
    expect(returnsTo(uri)).toEqual(expected);
  });
});

describe('the device an agent was let in from', () => {
  test.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
      'Safari on Mac',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome on iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox on Linux'],
    ['curl/8.5.0', null],
    [null, null],
  ])('%s', (agent, expected) => {
    expect(describeDevice(agent)).toBe(expected);
  });
});

describe('noting when a connection was last used', () => {
  /** The provider's key-value store, kept in memory, noting each write */
  function store() {
    const kept = new Map<string, string>();
    const writes: string[] = [];
    const kv = {
      get: (key: string) => Promise.resolve(kept.get(key) ?? null),
      put: (key: string, value: string) => {
        writes.push(key);
        kept.set(key, value);
        return Promise.resolve();
      },
    } as unknown as KVNamespace;
    return { kv, kept, writes };
  }
  const token = 'alice%40example.com:grantA1:secret';
  const minute = 60 * 1000;

  test('notes the first call, then at most every ten minutes', async () => {
    const { kv, kept, writes } = store();
    await noteAgentUse(kv, token, 1_000_000);
    expect(kept.get('agent-used:alice%40example.com:grantA1')).toBe('1000000');
    await noteAgentUse(kv, token, 1_000_000 + 9 * minute);
    expect(writes).toHaveLength(1);
    await noteAgentUse(kv, token, 1_000_000 + 10 * minute);
    expect(kept.get('agent-used:alice%40example.com:grantA1')).toBe(
      String(1_000_000 + 10 * minute),
    );
    expect(writes).toHaveLength(2);
  });

  test('notes nothing for a token it can’t read a connection from', async () => {
    const { kv, writes } = store();
    await noteAgentUse(kv, 'not-a-token', 1);
    await noteAgentUse(kv, 'alice::secret', 1);
    await noteAgentUse(kv, 'alice:bad/grant:secret', 1);
    expect(writes).toEqual([]);
  });
});

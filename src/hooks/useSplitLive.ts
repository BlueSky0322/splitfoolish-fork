import { useEffect, useRef } from 'react';
import { CLIENT_ID } from '../api';

const PING_MS = 30_000;
const MAX_RETRY_MS = 30_000;

/**
 * Listens for changes other people (or this account's other tabs) save to a split, and
 * calls onChange for each. Reconnects with backoff after a drop, and calls onChange
 * then too, since changes may have been missed while disconnected.
 */
export function useSplitLive(splitId: string, enabled: boolean, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const connect = () => {
      const url = `${location.origin.replace(/^http/, 'ws')}/api/splits/${encodeURIComponent(splitId)}/ws`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (retry > 0) latest.current();
        retry = 0;
        // Keeps proxies from closing a quiet connection; the room answers without waking
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
      };
      ws.onmessage = (e: MessageEvent<string>) => {
        if (e.data === 'pong') return;
        try {
          const message = JSON.parse(e.data) as { type?: string; by?: string | null };
          if (message.type === 'changed' && message.by !== CLIENT_ID) latest.current();
        } catch {
          // Not something this app sent
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        reconnect = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** retry++));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnect);
      clearInterval(ping);
      ws?.close();
    };
  }, [splitId, enabled]);
}

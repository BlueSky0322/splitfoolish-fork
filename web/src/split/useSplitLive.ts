import { useEffect, useRef } from 'react';
import { CLIENT_ID } from '../api';

const PING_MS = 30_000;
const MAX_RETRY_MS = 30_000;

/**
 * Listens for changes other people (or this account's other tabs) save to a split, and
 * calls onChange for each. Reconnects with backoff after a drop, and calls onChange
 * then too, since changes may have been missed while disconnected.
 *
 * Only connected while the app is on screen and online, to save battery and data: it
 * disconnects when hidden or offline, and catches up when it comes back.
 */
export function useSplitLive(splitId: string, enabled: boolean, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    // Set after a disconnect, so the next connection catches up on what was missed
    let missed = false;

    const wanted = () => document.visibilityState === 'visible' && navigator.onLine !== false;

    const connect = () => {
      clearTimeout(reconnect);
      if (closed || ws != null || !wanted()) return;
      const url = `${location.origin.replace(/^http/, 'ws')}/api/splits/${encodeURIComponent(splitId)}/ws`;
      const socket = new WebSocket(url);
      ws = socket;
      let ping: ReturnType<typeof setInterval> | undefined;
      socket.onopen = () => {
        if (missed) latest.current();
        missed = false;
        retry = 0;
        // Keeps proxies from closing a quiet connection; the room answers without waking
        ping = setInterval(
          () => socket.readyState === WebSocket.OPEN && socket.send('ping'),
          PING_MS,
        );
      };
      socket.onmessage = (e: MessageEvent<string>) => {
        if (e.data === 'pong') return;
        try {
          const message = JSON.parse(e.data) as { type?: string; by?: string | null };
          if (message.type === 'changed' && message.by !== CLIENT_ID) latest.current();
        } catch {
          // Not something this app sent
        }
      };
      socket.onclose = () => {
        clearInterval(ping);
        // A socket let go of earlier, closing after a new one opened: nothing to do
        if (ws !== socket) return;
        ws = null;
        missed = true;
        if (closed || !wanted()) return;
        reconnect = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** retry++));
      };
    };

    const disconnect = () => {
      clearTimeout(reconnect);
      const socket = ws;
      ws = null;
      if (socket) {
        missed = true;
        socket.close();
      }
    };

    // Hidden or offline: let go of the connection. Back: connect straight away.
    const update = () => {
      if (wanted()) {
        retry = 0;
        connect();
      } else {
        disconnect();
      }
    };

    connect();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      disconnect();
    };
  }, [splitId, enabled]);
}

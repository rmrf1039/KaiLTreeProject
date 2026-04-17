import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientRole, WSMessage } from '../../shared/src/types';

export type WSConnState = 'connecting' | 'open' | 'closed';

export function useWebSocket(role: ClientRole) {
  const [state, setState] = useState<WSConnState>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(m: WSMessage) => void>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let backoff = 500;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (cancelled) return;
      setState('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`, role);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setState('open');
        backoff = 500;
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as WSMessage;
          for (const fn of listenersRef.current) fn(msg);
        } catch {
          /* ignore malformed */
        }
      });
      ws.addEventListener('close', () => {
        setState('closed');
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 5000);
        }
      });
      ws.addEventListener('error', () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [role]);

  const subscribe = useCallback((fn: (m: WSMessage) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const send = useCallback((msg: WSMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { connState: state, subscribe, send };
}

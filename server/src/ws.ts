import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientRole, WSMessage } from '../../shared/src/types.js';
import { getCurrentTree } from './state.js';

type Client = WebSocket & { __role: ClientRole; __alive: boolean; __missedPongs: number };

const clients = new Set<Client>();

function roleFromRequest(req: IncomingMessage): ClientRole {
  const proto = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
  if (proto.includes('display')) return 'display';
  if (proto.includes('input')) return 'input';
  const url = new URL(req.url ?? '/', 'http://x');
  const q = url.searchParams.get('role');
  return q === 'display' ? 'display' : 'input';
}

export function countByRole(role: ClientRole): number {
  let n = 0;
  for (const c of clients) if (c.__role === role) n++;
  return n;
}

export function broadcast(msg: WSMessage, opts: { role?: ClientRole } = {}): void {
  const payload = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState !== WebSocket.OPEN) continue;
    if (opts.role && c.__role !== opts.role) continue;
    c.send(payload);
  }
}

function sendSnapshot(c: Client): void {
  const snap: WSMessage = {
    type: 'snapshot',
    currentTree: getCurrentTree(),
    inputs: countByRole('input'),
    displays: countByRole('display'),
  };
  c.send(JSON.stringify(snap));
}

function broadcastPresence(): void {
  const msg: WSMessage = {
    type: 'snapshot',
    currentTree: getCurrentTree(),
    inputs: countByRole('input'),
    displays: countByRole('display'),
  };
  const payload = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

export function attachWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (raw, req) => {
    const ws = raw as Client;
    ws.__role = roleFromRequest(req);
    ws.__alive = true;
    ws.__missedPongs = 0;
    clients.add(ws);

    sendSnapshot(ws);
    broadcastPresence();

    ws.on('pong', () => {
      ws.__alive = true;
      ws.__missedPongs = 0;
    });

    ws.on('message', (data) => {
      let parsed: WSMessage | null = null;
      try {
        parsed = JSON.parse(String(data)) as WSMessage;
      } catch {
        return;
      }
      if (!parsed) return;
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' } satisfies WSMessage));
      } else if (parsed.type === 'display:rendering') {
        broadcast(parsed, { role: 'input' });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      broadcastPresence();
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  const HEARTBEAT_MS = 15_000;
  setInterval(() => {
    for (const c of clients) {
      if (c.readyState !== WebSocket.OPEN) continue;
      if (!c.__alive) {
        c.__missedPongs++;
        if (c.__missedPongs >= 2) {
          c.terminate();
          continue;
        }
      }
      c.__alive = false;
      try {
        c.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS).unref();
}

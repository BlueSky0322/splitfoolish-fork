// One room per split, holding the WebSocket of everyone who has it open. It keeps no
// data: when a change is saved, the Worker asks the room to tell everyone, and each app
// fetches the split again. Sockets hibernate between messages, so an idle room costs
// nothing.

import { DurableObject } from 'cloudflare:workers';

/** What the room sends: a split changed, and which tab changed it (it ignores its own) */
export interface RoomMessage {
  type: 'changed';
  by: string | null;
}

export class SplitRoom extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Apps ping to keep the connection alive; answered without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  fetch(req: Request): Response {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Already closing; it's dropped below when it does
      }
    }
  }

  webSocketMessage(): void {
    // Apps only listen; anything but the ping (answered above) is ignored
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close(1000, 'Closed');
    } catch {
      // Already closed
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }
}

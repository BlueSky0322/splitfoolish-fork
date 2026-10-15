// One room per split, holding the WebSocket of everyone who has it open. It keeps no
// data: when a change is saved, the Worker asks the room to tell everyone, and each app
// fetches the split again. Sockets hibernate between messages, so an idle room costs
// nothing. The functions below are how the Worker's routes reach a split's room.

import { DurableObject } from 'cloudflare:workers';
import { LIVE_PING, LIVE_PONG, LIVE_REMOVED_CODE, type RoomMessage } from '../shared/api';

/** Set by the Worker when it hands a member's socket to the room: whose it is */
const MEMBER_HEADER = 'X-Split-Member';

type WaitUntil = { waitUntil: (p: Promise<unknown>) => void };

/** The room for a split, where everyone with it open is listening */
/** What the rooms need from the Worker's bindings: one room per split */
export interface RoomEnv {
  SPLIT_ROOM: DurableObjectNamespace<SplitRoom>;
}

const splitRoom = (env: RoomEnv, splitId: string) =>
  env.SPLIT_ROOM.get(env.SPLIT_ROOM.idFromName(splitId));

/**
 * Tells everyone with the split open that it changed, after the response is sent.
 * `by` is the tab that made the change (see clientId in http.ts), which ignores it.
 */
export const notifySplit = (env: RoomEnv, ctx: WaitUntil, splitId: string, by: string | null) => {
  const message: RoomMessage = { type: 'changed', by };
  ctx.waitUntil(
    splitRoom(env, splitId)
      .broadcast(JSON.stringify(message))
      .catch((err: unknown) => console.error(err)),
  );
};

/** Opens a member's live-update socket in the split's room, tagged as theirs */
export const joinRoom = (env: RoomEnv, splitId: string, req: Request, email: string) => {
  const headers = new Headers(req.headers);
  headers.set(MEMBER_HEADER, email);
  return splitRoom(env, splitId).fetch(new Request(req, { headers }));
};

/** Closes the live-update sockets of people taken out of a split, after the response */
export const evictFromRoom = (env: RoomEnv, ctx: WaitUntil, splitId: string, emails: string[]) => {
  if (emails.length === 0) return;
  const room = splitRoom(env, splitId);
  ctx.waitUntil(
    Promise.all(emails.map((email) => room.evict(email))).catch((err: unknown) =>
      console.error(err),
    ),
  );
};

export class SplitRoom extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Apps ping to keep the connection alive; answered without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG));
  }

  fetch(req: Request): Response {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    // Tagged with the member's email, so their sockets can be found if they leave
    const member = req.headers.get(MEMBER_HEADER);
    this.ctx.acceptWebSocket(server, member ? [member] : []);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Closes the sockets of someone who is no longer in the split */
  evict(email: string): void {
    for (const ws of this.ctx.getWebSockets(email)) {
      try {
        ws.close(LIVE_REMOVED_CODE, 'No longer in this split');
      } catch {
        // Already closing
      }
    }
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

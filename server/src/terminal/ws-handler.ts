import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { Duplex } from 'stream';
import { getRedis } from '../db/redis.js';
import { getSession } from '../sessions/session-service.js';
import { execInteractive } from '../sessions/container-manager.js';

// ---------------------------------------------------------------------------
// Connection tracking
// ---------------------------------------------------------------------------

const activeConnections = new Map<string, WebSocket[]>();

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10_000; // 10 seconds

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// initWebSocket
// ---------------------------------------------------------------------------

export function initWebSocket(server: HTTPServer): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade manually so we only accept connections at /ws
  server.on('upgrade', (req, socket, head) => {
    try {
      const baseUrl = `http://${req.headers.host ?? 'localhost'}`;
      const url = new URL(req.url ?? '/', baseUrl);

      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  // Handle new connections
  wss.on('connection', async (ws: WebSocket, req) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;

    try {
      // 1. Parse query params
      const baseUrl = `http://${req.headers.host ?? 'localhost'}`;
      const url = new URL(req.url ?? '/', baseUrl);
      const sessionId = url.searchParams.get('session');
      const ticket = url.searchParams.get('ticket');

      if (!sessionId || !ticket) {
        ws.send(JSON.stringify({ error: 'Missing session or ticket query parameter' }));
        ws.close(1008, 'Missing parameters');
        return;
      }

      // 2. Verify one-time ticket (1.4 — replaces JWT in query params)
      const redis = getRedis();
      const ticketKey = `ws-ticket:${ticket}`;
      const ticketValue = await redis.get(ticketKey);

      if (!ticketValue) {
        ws.send(JSON.stringify({ error: 'Invalid or expired ticket' }));
        ws.close(1008, 'Authentication failed');
        return;
      }

      // Delete ticket immediately (single-use)
      await redis.del(ticketKey);

      // Parse userId:sessionId from ticket value
      const [userId, ticketSessionId] = ticketValue.split(':');
      if (!userId || ticketSessionId !== sessionId) {
        ws.send(JSON.stringify({ error: 'Ticket does not match session' }));
        ws.close(1008, 'Authentication failed');
        return;
      }

      // 3. Verify session belongs to user and is active
      const session = await getSession(sessionId, userId);

      if (!session) {
        ws.send(JSON.stringify({ error: 'Session not found or access denied' }));
        ws.close(1008, 'Session not found');
        return;
      }

      if (session.status !== 'active') {
        ws.send(JSON.stringify({ error: `Session is not active (status: ${session.status})` }));
        ws.close(1008, 'Session not active');
        return;
      }

      // 4. Start interactive exec inside the container
      let stream: Duplex;
      let exec: Awaited<ReturnType<typeof execInteractive>>['exec'];

      try {
        const result = await execInteractive(session.container_id);
        stream = result.stream as unknown as Duplex;
        exec = result.exec;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        ws.send(JSON.stringify({ error: `Failed to start terminal: ${message}` }));
        ws.close(1011, 'Exec failed');
        return;
      }

      // 5. Track connection
      if (!activeConnections.has(sessionId)) {
        activeConnections.set(sessionId, []);
      }
      activeConnections.get(sessionId)!.push(ws);

      // 6. Pipe: ws → container stdin
      ws.on('message', (data: Buffer | string) => {
        try {
          const message = typeof data === 'string' ? data : data.toString();

          // Check if the message is a JSON control message
          if (typeof message === 'string' && message.startsWith('{')) {
            try {
              const parsed = JSON.parse(message);

              if (parsed.type === 'resize' && parsed.rows && parsed.cols) {
                exec.resize({ h: parsed.rows, w: parsed.cols });
                return;
              }
            } catch {
              // Not valid JSON — fall through and write as terminal input
            }
          }

          // Write raw data to the container stdin
          stream.write(typeof data === 'string' ? data : data);
        } catch {
          // Stream may already be closed; ignore write errors
        }
      });

      // 7. Pipe: container stdout → ws
      stream.on('data', (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      });

      // 8. Stream end → close ws
      stream.on('end', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Terminal session ended');
        }
      });

      stream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Terminal session closed');
        }
      });

      // 9. WS close → destroy stream
      ws.on('close', () => {
        stream.destroy();
        removeConnection(sessionId, ws);
        clearHeartbeat(extWs);
      });

      // 10. Error handling
      ws.on('error', (err) => {
        console.error(`[WS] WebSocket error for session ${sessionId}:`, err.message);
        stream.destroy();
        removeConnection(sessionId, ws);
        clearHeartbeat(extWs);
      });

      stream.on('error', (err: Error) => {
        console.error(`[WS] Stream error for session ${sessionId}:`, err.message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'Stream error');
        }
      });

      // 11. Heartbeat setup
      setupHeartbeat(extWs);

      console.log(`[WS] Terminal connected for session ${sessionId} (user ${userId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WS] Unexpected error during connection setup:', message);
      try {
        ws.send(JSON.stringify({ error: 'Internal server error' }));
        ws.close(1011, 'Internal error');
      } catch {
        // ws may already be closed
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Heartbeat helpers
// ---------------------------------------------------------------------------

function setupHeartbeat(ws: ExtWebSocket): void {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const interval = setInterval(() => {
    if (!ws.isAlive) {
      console.log('[WS] Client failed heartbeat — terminating connection');
      clearInterval(interval);
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping();

    // If no pong within timeout, mark as dead
    ws.heartbeatTimer = setTimeout(() => {
      if (!ws.isAlive) {
        console.log('[WS] Heartbeat timeout — terminating connection');
        clearInterval(interval);
        ws.terminate();
      }
    }, HEARTBEAT_TIMEOUT);
  }, HEARTBEAT_INTERVAL);

  ws.on('close', () => {
    clearInterval(interval);
    clearHeartbeat(ws);
  });
}

function clearHeartbeat(ws: ExtWebSocket): void {
  if (ws.heartbeatTimer) {
    clearTimeout(ws.heartbeatTimer);
    ws.heartbeatTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Connection tracking helpers
// ---------------------------------------------------------------------------

function removeConnection(sessionId: string, ws: WebSocket): void {
  const connections = activeConnections.get(sessionId);
  if (!connections) return;

  const idx = connections.indexOf(ws);
  if (idx !== -1) {
    connections.splice(idx, 1);
  }

  if (connections.length === 0) {
    activeConnections.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// broadcastToSession
// ---------------------------------------------------------------------------

export function broadcastToSession(sessionId: string, event: object): void {
  const connections = activeConnections.get(sessionId);
  if (!connections) return;

  const payload = JSON.stringify(event);

  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

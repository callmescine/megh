import { execCommand } from '../sessions/container-manager.js';
import { broadcastToSession } from '../terminal/ws-handler.js';
import { query } from '../db/connection.js';
import { getConfig } from '../config.js';
import { signPreviewToken } from './routes.js';

/**
 * Tracks currently active ports per session.
 * Key = sessionId, Value = Set of port numbers currently listening.
 */
const activePorts = new Map<string, Set<number>>();

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Parse the output of `ss -tlnp` and return an array of listening port numbers.
 *
 * Example lines:
 *   State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port  Process
 *   LISTEN  0       128      0.0.0.0:5173          0.0.0.0:*
 *   LISTEN  0       128      [::]:3000              [::]:*
 */
export function parseSsOutput(output: string): number[] {
  const ports: number[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Only consider lines in LISTEN state
    if (!/\bLISTEN\b/.test(line)) continue;

    // Match the local address:port portion.
    // Handles both IPv4 (0.0.0.0:5173, 127.0.0.1:3000, *:8080)
    // and IPv6 ([::]:3000, [::1]:8080)
    const match = line.match(/(?:\[?[\w.:*]+\]?):(\d+)\s/);
    if (match) {
      const port = parseInt(match[1], 10);
      if (!isNaN(port) && port > 0) {
        ports.push(port);
      }
    }
  }

  // Deduplicate (a port may appear for both v4 and v6)
  return [...new Set(ports)];
}

/**
 * Start periodic port detection for all active sessions.
 * Polls every 5 seconds.
 */
export function startPortDetection(): void {
  if (intervalHandle) {
    console.warn('[PortDetector] Already running');
    return;
  }

  const config = getConfig();
  const domain = config.platform.domain;

  // Ports to ignore — these are internal/system services, not user servers
  const ignoredPorts = new Set([22, 53, 631]);

  console.log('[PortDetector] Starting port detection (interval: 5s, dynamic)');

  intervalHandle = setInterval(async () => {
    try {
      const result = await query(
        `SELECT id, container_id FROM sessions WHERE status = 'active'`,
      );

      // Track which sessions are still active to clean up stale entries
      const activeSessionIds = new Set<string>();

      for (const session of result.rows) {
        const sessionId: string = session.id;
        const containerId: string = session.container_id;

        activeSessionIds.add(sessionId);
        if (!containerId) continue;

        try {
          const output = await execCommand(containerId, ['ss', '-tlnp']);
          const listeningPorts = parseSsOutput(output);

          // Accept any user port, only skip known system ports
          const currentPorts = new Set(listeningPorts.filter((p) => !ignoredPorts.has(p)));

          // Get previously known ports for this session
          const previousPorts = activePorts.get(sessionId) || new Set<number>();

          // Detect new ports
          for (const port of currentPorts) {
            if (!previousPorts.has(port)) {
              const token = signPreviewToken(sessionId, port);
              const previewUrl = `https://${domain}/preview/${sessionId}/${port}/?token=${token}`;
              console.log(`[PortDetector] Port opened: session=${sessionId} port=${port}`);

              broadcastToSession(sessionId, {
                type: 'preview',
                port,
                url: previewUrl,
              });
            }
          }

          // Detect removed ports
          for (const port of previousPorts) {
            if (!currentPorts.has(port)) {
              console.log(`[PortDetector] Port closed: session=${sessionId} port=${port}`);

              broadcastToSession(sessionId, {
                type: 'preview_close',
                port,
              });
            }
          }

          // Update tracked state
          activePorts.set(sessionId, currentPorts);
        } catch (err) {
          // Container might be starting up or shutting down — skip silently
          console.debug(
            `[PortDetector] Failed to check ports for session ${sessionId}:`,
            (err as Error).message,
          );
        }
      }

      // Fix #3: Clean up entries for sessions that are no longer active
      for (const sessionId of activePorts.keys()) {
        if (!activeSessionIds.has(sessionId)) {
          activePorts.delete(sessionId);
        }
      }
    } catch (err) {
      console.error('[PortDetector] Error querying sessions:', (err as Error).message);
    }
  }, 5_000);
}

/**
 * Stop the port detection interval and clear tracked state.
 */
export function stopPortDetection(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    activePorts.clear();
    console.log('[PortDetector] Stopped');
  }
}

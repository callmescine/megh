import { execCommand } from '../sessions/container-manager.js';
import { broadcastToSession } from '../terminal/ws-handler.js';
import { query } from '../db/connection.js';
import { getConfig } from '../config.js';

/**
 * Tracks which ports have already been broadcast per session,
 * so we don't send duplicate "preview" events.
 * Key = sessionId, Value = Set of port numbers already announced.
 */
const detectedPorts = new Map<string, Set<number>>();

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

      for (const session of result.rows) {
        const sessionId: string = session.id;
        const containerId: string = session.container_id;

        if (!containerId) continue;

        try {
          const output = await execCommand(containerId, ['ss', '-tlnp']);
          const listeningPorts = parseSsOutput(output);

          // Accept any user port, only skip known system ports
          const relevantPorts = listeningPorts.filter((p) => !ignoredPorts.has(p));

          // Get or create the set of already-detected ports for this session
          if (!detectedPorts.has(sessionId)) {
            detectedPorts.set(sessionId, new Set());
          }
          const alreadyDetected = detectedPorts.get(sessionId)!;

          for (const port of relevantPorts) {
            if (!alreadyDetected.has(port)) {
              alreadyDetected.add(port);

              // Use container port directly — the API preview proxy
              // resolves the container IP and forwards to it
              const previewUrl = `https://${domain}/preview/${sessionId}/${port}/`;
              console.log(`[PortDetector] New port detected: session=${sessionId} port=${port} url=${previewUrl}`);

              broadcastToSession(sessionId, {
                type: 'preview',
                port,
                url: previewUrl,
              });
            }
          }
        } catch (err) {
          // Container might be starting up or shutting down — skip silently
          console.debug(
            `[PortDetector] Failed to check ports for session ${sessionId}:`,
            (err as Error).message,
          );
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
    detectedPorts.clear();
    console.log('[PortDetector] Stopped');
  }
}

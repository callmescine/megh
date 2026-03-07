import { Router, Request, Response } from 'express';
import http from 'http';
import { query } from '../db/connection.js';
import { getContainerIp } from '../sessions/container-manager.js';

export const previewRouter = Router();

/**
 * GET /preview/:sessionId/:port/* — reverse-proxy to the container's internal port.
 *
 * Looks up the container IP on the megh_containers network and proxies
 * the request directly, so any port works without Docker port bindings.
 */
previewRouter.all('/:sessionId/:port/*', async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.params.sessionId as string;
  const port = req.params.port as string;
  const portNum = parseInt(port, 10);

  if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
    res.status(400).json({ error: 'Invalid port' });
    return;
  }

  try {
    // Look up the session to get container_id
    const result = await query(
      `SELECT container_id, status FROM sessions WHERE id = $1`,
      [sessionId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const session = result.rows[0];
    if (session.status !== 'active' && session.status !== 'grace') {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    const containerIp = await getContainerIp(session.container_id);
    if (!containerIp) {
      res.status(502).json({ error: 'Cannot reach container' });
      return;
    }

    // Build the path after /preview/:sessionId/:port
    const forwardPath = req.params[0] ? `/${req.params[0]}` : '/';
    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = `http://${containerIp}:${portNum}${forwardPath}${queryString}`;

    // Proxy the request
    const proxyReq = http.request(
      target,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: req.headers.host || '',
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      console.error(`[Preview] Proxy error for ${sessionId}:${portNum}:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Service not reachable on this port' });
      }
    });

    req.pipe(proxyReq);
  } catch (err) {
    console.error('[Preview] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Preview proxy failed' });
    }
  }
});

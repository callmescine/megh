import client from 'prom-client';
import { Router, Request, Response } from 'express';

// Collect default Node.js metrics
client.collectDefaultMetrics({ prefix: 'megh_' });

// Custom metrics
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const activeSessions = new client.Gauge({
  name: 'megh_active_sessions',
  help: 'Number of currently active sessions',
});

export const containersCreated = new client.Counter({
  name: 'megh_containers_created_total',
  help: 'Total number of containers created',
});

export const webhooksProcessed = new client.Counter({
  name: 'megh_webhooks_processed_total',
  help: 'Total number of webhooks processed',
  labelNames: ['event_type'],
});

// Metrics endpoint router
export const metricsRouter = Router();

metricsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.end(metrics);
  } catch (err) {
    res.status(500).end();
  }
});

// HTTP request duration middleware
export function metricsMiddleware(req: Request, res: Response, next: () => void): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path || req.path;
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { createServer } from 'http';
import { loadConfig } from './config.js';
import { initPool, testConnection, closePool } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { authRouter } from './auth/routes.js';
import { csrfProtection } from './auth/middleware.js';
import { sessionRouter } from './sessions/routes.js';
import { uploadRouter } from './uploads/routes.js';
import { billingRouter, stripeWebhookRouter, razorpayWebhookRouter } from './billing/routes.js';
import { registerProvider } from './billing/provider-registry.js';
import { stripeProvider } from './billing/stripe-service.js';
import { razorpayProvider } from './billing/razorpay-service.js';
import { initWebSocket } from './terminal/ws-handler.js';
import { initScheduler } from './jobs/scheduler.js';
import { initRedis, closeRedis } from './db/redis.js';
import { initTTLSubscriber } from './sessions/session-service.js';
import { startPortDetection, stopPortDetection } from './preview/port-detector.js';
import { previewRouter, subdomainPreviewRouter } from './preview/routes.js';
import { pingDocker } from './sessions/container-manager.js';
import { adminRouter } from './admin/routes.js';
import { metricsMiddleware, metricsRouter } from './metrics.js';
import { openapiSpec } from './openapi.js';
import swaggerUi from 'swagger-ui-express';

async function main() {
  const config = loadConfig();
  console.log(`[Megh] Starting ${config.platform.name}...`);

  // Initialize database
  initPool(config.database);
  await testConnection();
  await runMigrations();
  console.log('[Megh] Database ready');

  // Initialize Redis
  await initRedis(config.redis);
  console.log('[Megh] Redis ready');

  // Express app
  const app = express();
  app.set('trust proxy', 1);

  // Register payment providers
  registerProvider(stripeProvider);
  registerProvider(razorpayProvider);

  // Webhooks need raw body — mount before json parser
  app.use('/webhooks/stripe', stripeWebhookRouter);
  app.use('/webhooks/razorpay', razorpayWebhookRouter);

  // Preview proxies — mount before json/helmet/csrf to avoid consuming
  // request body and adding headers that break proxied content.
  // Subdomain preview needs cookie-parser for auth but is mounted before
  // the global cookieParser(), so we add it inline.
  app.use('/preview-sub', cookieParser(), subdomainPreviewRouter);
  app.use('/preview', previewRouter);

  app.use(helmet());
  app.use(cors({ origin: config.server.cors_origins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // Prometheus metrics middleware
  app.use(metricsMiddleware);

  // Request ID middleware (3.2)
  app.use((req, _res, next) => {
    req.id = crypto.randomUUID();
    _res.setHeader('X-Request-Id', req.id);
    next();
  });

  // CSRF protection (1.6)
  app.use(csrfProtection);

  // Health checks (3.3)
  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const checks: Record<string, string> = {};

    try {
      const { query } = await import('./db/connection.js');
      await query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'fail';
    }

    try {
      const { getRedis } = await import('./db/redis.js');
      await getRedis().ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
    }

    try {
      await pingDocker();
      checks.docker = 'ok';
    } catch {
      checks.docker = 'fail';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    const status = allOk ? 'ok' : 'degraded';
    const statusCode = allOk ? 200 : 503;

    res.status(statusCode).json({
      status,
      checks,
      uptime: process.uptime(),
    });
  });

  app.get('/api/health', async (_req, res) => {
    const checks: Record<string, string> = {};

    try {
      const { query } = await import('./db/connection.js');
      await query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'fail';
    }

    try {
      const { getRedis } = await import('./db/redis.js');
      await getRedis().ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
    }

    try {
      await pingDocker();
      checks.docker = 'ok';
    } catch {
      checks.docker = 'fail';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    const status = allOk ? 'ok' : 'degraded';
    const statusCode = allOk ? 200 : 503;

    res.status(statusCode).json({
      status,
      name: config.platform.name,
      checks,
      uptime: process.uptime(),
    });
  });

  // Metrics endpoint
  app.use('/metrics', metricsRouter);

  // OpenAPI/Swagger docs
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/sessions', sessionRouter);
  app.use('/api/sessions', uploadRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/admin', adminRouter);

  // HTTP server
  const server = createServer(app);

  // WebSocket
  initWebSocket(server);

  // Scheduled jobs
  initScheduler();

  // TTL expiry subscriber
  await initTTLSubscriber();

  // Port detection for previews
  startPortDetection();

  // Start
  server.listen(config.server.port, () => {
    console.log(`[Megh] API server listening on port ${config.server.port}`);
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown (2.1)
  // ---------------------------------------------------------------------------

  let shutdownInProgress = false;

  async function gracefulShutdown(signal: string) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`[Megh] Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log('[Megh] HTTP server closed');
    });

    // Stop port detection
    stopPortDetection();

    // Force exit after 10 seconds
    const forceExitTimer = setTimeout(() => {
      console.error('[Megh] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    try {
      // Close database pool
      await closePool();
      console.log('[Megh] Database pool closed');
    } catch (err) {
      console.error('[Megh] Error closing database pool:', err);
    }

    try {
      // Close Redis connections
      await closeRedis();
      console.log('[Megh] Redis connections closed');
    } catch (err) {
      console.error('[Megh] Error closing Redis:', err);
    }

    clearTimeout(forceExitTimer);
    console.log('[Megh] Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Megh] Fatal error:', err);
  process.exit(1);
});

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import IORedis from 'ioredis';
const Redis = IORedis as any;
import { v4 as uuidv4 } from 'uuid';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const configPath = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../../config.yaml');
const configFile = readFileSync(configPath, 'utf-8');
const config = parseYaml(configFile) as {
  database: { host: string; port: number; user: string; password: string; database: string };
  redis: { host: string; port: number; password?: string };
  proxy: { port: number; rate_limit: number };
  llm: { api_key: string };
  billing: {
    markup_multiplier: number;
    model_rates: Record<string, { input: number; output: number }>;
  };
};

// ---------------------------------------------------------------------------
// Database & Redis connections
// ---------------------------------------------------------------------------

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
});

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = config.billing.model_rates[model] || { input: 3.0, output: 15.0 };
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return (inputCost + outputCost) * config.billing.markup_multiplier;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function recordUsageEvent(
  userId: string,
  sessionId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO usage_events (id, user_id, session_id, model, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv4(), userId, sessionId, model, inputTokens, outputTokens, costUsd],
    );
  } catch (err) {
    console.error('Failed to record usage event:', err);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window per minute)
// ---------------------------------------------------------------------------

async function checkRateLimit(userId: string): Promise<boolean> {
  const currentMinute = Math.floor(Date.now() / 60_000);
  const key = `ratelimit:${userId}:${currentMinute}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }
  return count <= config.proxy.rate_limit;
}

// ---------------------------------------------------------------------------
// Upstream forwarding
// ---------------------------------------------------------------------------

interface SessionAuth {
  type: 'oauth' | 'api_key';
  token?: string;
  key?: string;
}

async function getSessionAuth(sessionId: string): Promise<SessionAuth | null> {
  try {
    const raw = await redis.get(`session:${sessionId}:auth`);
    if (raw) return JSON.parse(raw);
  } catch {
    // Fall through to default
  }
  return null;
}

function applyAuth(
  headers: Record<string, string | string[] | undefined>,
  auth: SessionAuth | null,
): void {
  // Remove any client-sent auth headers
  delete headers['x-api-key'];
  delete headers['authorization'];
  delete headers['Authorization'];

  if (auth?.type === 'oauth' && auth.token) {
    headers['authorization'] = `Bearer ${auth.token}`;
  } else if (auth?.type === 'api_key' && auth.key) {
    headers['x-api-key'] = auth.key;
  } else {
    // Fall back to global config API key
    headers['x-api-key'] = config.llm.api_key;
  }
  headers['anthropic-version'] = '2023-06-01';
}

function forwardToAnthropic(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  auth: SessionAuth | null,
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>;

function forwardToAnthropic(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  auth: SessionAuth | null,
  streamCallback: (chunk: Buffer) => void,
  streamEnd: (fullBody: Buffer) => void,
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }>;

function forwardToAnthropic(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  auth: SessionAuth | null,
  streamCallback?: (chunk: Buffer) => void,
  streamEnd?: (fullBody: Buffer) => void,
): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const forwardHeaders: Record<string, string | string[] | undefined> = { ...headers };

    // Remove hop-by-hop / host headers
    delete forwardHeaders['host'];
    delete forwardHeaders['Host'];

    // Inject upstream credentials based on session auth config
    applyAuth(forwardHeaders, auth);

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path,
      method,
      headers: forwardHeaders as Record<string, string | string[]>,
    };

    const upstreamReq = httpsRequest(options, (upstreamRes) => {
      const statusCode = upstreamRes.statusCode ?? 502;
      const resHeaders = upstreamRes.headers as Record<string, string | string[] | undefined>;

      if (streamCallback && streamEnd) {
        // Streaming mode – forward chunks to caller, but also accumulate for parsing
        const accumulated: Buffer[] = [];

        upstreamRes.on('data', (chunk: Buffer) => {
          accumulated.push(chunk);
          streamCallback(chunk);
        });

        upstreamRes.on('end', () => {
          streamEnd(Buffer.concat(accumulated));
          resolve({ statusCode, headers: resHeaders });
        });

        upstreamRes.on('error', reject);
      } else {
        // Non-streaming – collect full body
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          resolve({ statusCode, headers: resHeaders, body: Buffer.concat(chunks) });
        });
        upstreamRes.on('error', reject);
      }
    });

    upstreamReq.on('error', reject);
    upstreamReq.write(body);
    upstreamReq.end();
  });
}

// ---------------------------------------------------------------------------
// SSE parser – extract token usage from streaming events
// ---------------------------------------------------------------------------

function parseSSEUsage(rawBody: Buffer): { inputTokens: number; outputTokens: number; model: string } {
  const text = rawBody.toString('utf-8');
  let inputTokens = 0;
  let outputTokens = 0;
  let model = 'unknown';

  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (dataStr === '[DONE]') continue;

    try {
      const data = JSON.parse(dataStr);

      if (data.type === 'message_start' && data.message) {
        if (data.message.model) {
          model = data.message.model;
        }
        if (data.message.usage?.input_tokens) {
          inputTokens = data.message.usage.input_tokens;
        }
      }

      if (data.type === 'message_delta' && data.usage?.output_tokens) {
        outputTokens = data.usage.output_tokens;
      }
    } catch {
      // Ignore malformed JSON lines
    }
  }

  return { inputTokens, outputTokens, model };
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const path = req.url ?? '/';

  // Health check
  if (method === 'GET' && path === '/health') {
    jsonResponse(res, 200, { status: 'ok' });
    return;
  }

  // ---- Authenticate via session header or API key ----
  let sessionId = req.headers['x-session-id'] as string | undefined;

  // If no explicit session header, extract session ID from the API key
  // Containers set ANTHROPIC_API_KEY=megh-session-{sessionId}
  if (!sessionId) {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey && apiKey.startsWith('megh-session-')) {
      sessionId = apiKey.slice('megh-session-'.length);
    }
  }

  if (!sessionId) {
    jsonResponse(res, 403, { error: 'Missing session identifier' });
    return;
  }

  const userId = await redis.get(`session:${sessionId}:user`);
  if (!userId) {
    jsonResponse(res, 403, { error: 'Invalid session' });
    return;
  }

  // ---- Rate limiting ----
  const allowed = await checkRateLimit(userId);
  if (!allowed) {
    jsonResponse(res, 429, { error: 'Rate limit exceeded' });
    return;
  }

  // ---- Read request body ----
  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    console.error('Error reading request body:', err);
    jsonResponse(res, 400, { error: 'Failed to read request body' });
    return;
  }

  // ---- Check balance ----
  let balanceStr = await redis.get(`user:${userId}:balance`);
  if (balanceStr === null) {
    // Fall back to PostgreSQL and cache the result
    try {
      const dbResult = await pool.query(
        'SELECT balance_usd FROM billing_accounts WHERE user_id = $1',
        [userId],
      );
      if (dbResult.rows.length > 0) {
        balanceStr = String(dbResult.rows[0].balance_usd);
        await redis.set(`user:${userId}:balance`, balanceStr, 'EX', 30);
      }
    } catch (err) {
      console.error('Failed to fetch balance from DB:', err);
    }
  }
  let balance = 0;
  if (balanceStr !== null) {
    // Guard against JSON-encoded balance (from usage-service cache conflicts)
    try {
      const parsed = JSON.parse(balanceStr);
      balance = typeof parsed === 'object' ? parseFloat(parsed.balance_usd) : parseFloat(balanceStr);
    } catch {
      balance = parseFloat(balanceStr);
    }
    if (isNaN(balance)) balance = 0;
  }
  if (balance < 0.01) {
    jsonResponse(res, 402, { error: 'Insufficient balance' });
    return;
  }

  // ---- Forward to Anthropic ----
  const reqHeaders = req.headers as Record<string, string | string[] | undefined>;

  // Fetch session-specific auth config (OAuth token or API key)
  const auth = await getSessionAuth(sessionId);

  try {
    // Make a preliminary request to determine if response is streaming
    const isStreamingRequest = (() => {
      try {
        const parsed = JSON.parse(body.toString('utf-8'));
        return parsed.stream === true;
      } catch {
        return false;
      }
    })();

    if (isStreamingRequest) {
      await handleStreaming(method, path, reqHeaders, body, res, userId, sessionId, auth);
    } else {
      // ---- Non-streaming response ----
      const upstream = await forwardToAnthropic(method, path, reqHeaders, body, auth);

      // Parse usage from response
      let inputTokens = 0;
      let outputTokens = 0;
      let model = 'unknown';

      try {
        const parsed = JSON.parse(upstream.body!.toString('utf-8'));
        inputTokens = parsed?.usage?.input_tokens ?? 0;
        outputTokens = parsed?.usage?.output_tokens ?? 0;
        model = parsed?.model ?? 'unknown';
      } catch {
        // Non-JSON response, skip metering
      }

      // Calculate cost and deduct
      if (inputTokens > 0 || outputTokens > 0) {
        const cost = calculateCost(model, inputTokens, outputTokens);

        // Deduct from balance (fire-and-forget)
        redis.incrbyfloat(`user:${userId}:balance`, -cost).catch((err: Error) => {
          console.error('Failed to deduct balance:', err);
        });

        // Record usage event async (don't await)
        recordUsageEvent(userId, sessionId, model, inputTokens, outputTokens, cost);
      }

      // Forward response to caller
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (value !== undefined) {
          responseHeaders[key] = value as string | string[];
        }
      }

      res.writeHead(upstream.statusCode, responseHeaders);
      res.end(upstream.body);
    }
  } catch (err) {
    console.error('Error forwarding request to Anthropic:', err);
    jsonResponse(res, 502, { error: 'Upstream request failed' });
  }
}

// ---------------------------------------------------------------------------
// Streaming handler (dedicated implementation for correct chunk piping)
// ---------------------------------------------------------------------------

function handleStreaming(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  clientRes: ServerResponse,
  userId: string,
  sessionId: string,
  auth: SessionAuth | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const forwardHeaders: Record<string, string | string[] | undefined> = { ...headers };

    delete forwardHeaders['host'];
    delete forwardHeaders['Host'];

    applyAuth(forwardHeaders, auth);

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path,
      method,
      headers: forwardHeaders as Record<string, string | string[]>,
    };

    const upstreamReq = httpsRequest(options, (upstreamRes) => {
      const statusCode = upstreamRes.statusCode ?? 502;

      // Forward response headers to client
      const resHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) {
          resHeaders[key] = value as string | string[];
        }
      }
      clientRes.writeHead(statusCode, resHeaders);

      const accumulated: Buffer[] = [];

      upstreamRes.on('data', (chunk: Buffer) => {
        accumulated.push(chunk);
        try {
          clientRes.write(chunk);
        } catch (err) {
          console.error('Error writing stream chunk to client:', err);
        }
      });

      upstreamRes.on('end', () => {
        const fullBody = Buffer.concat(accumulated);
        const { inputTokens, outputTokens, model } = parseSSEUsage(fullBody);
        const cost = calculateCost(model, inputTokens, outputTokens);

        // Deduct balance (fire-and-forget)
        redis.incrbyfloat(`user:${userId}:balance`, -cost).catch((err: Error) => {
          console.error('Failed to deduct balance:', err);
        });

        // Record usage event (fire-and-forget)
        recordUsageEvent(userId, sessionId, model, inputTokens, outputTokens, cost);

        clientRes.end();
        resolve();
      });

      upstreamRes.on('error', (err) => {
        console.error('Upstream stream error:', err);
        try {
          clientRes.end();
        } catch {
          // Client already closed
        }
        reject(err);
      });
    });

    upstreamReq.on('error', (err) => {
      console.error('Upstream request error:', err);
      try {
        jsonResponse(clientRes, 502, { error: 'Upstream request failed' });
      } catch {
        // Headers may have already been sent
      }
      reject(err);
    });

    upstreamReq.write(body);
    upstreamReq.end();
  });
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

const PORT = config.proxy?.port ?? 8787;

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err: Error) => {
    console.error('Unhandled error in request handler:', err);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: 'Internal server error' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Usage proxy listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(async () => {
    await redis.quit();
    await pool.end();
    console.log('Usage proxy shut down.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(async () => {
    await redis.quit();
    await pool.end();
    console.log('Usage proxy shut down.');
    process.exit(0);
  });
});

import Docker from 'dockerode';
import { readFileSync } from 'fs';
import { getConfig } from '../config.js';
import { getRedis } from '../db/redis.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ---------------------------------------------------------------------------
// OAuth token from mounted file (host-side script refreshes from Keychain)
// ---------------------------------------------------------------------------

const OAUTH_TOKEN_FILE = '/app/secrets/oauth-token';

/**
 * Read the OAuth token from the host-mounted file.
 * Always reads fresh (no caching) — the host-side refresh script updates
 * this file when Claude Code CLI rotates the token in Keychain.
 */
function getOAuthTokenFromFile(): string | null {
  try {
    const token = readFileSync(OAUTH_TOKEN_FILE, 'utf-8').trim();
    if (token) {
      return token;
    }
  } catch {
    // File doesn't exist or isn't readable — that's fine
  }
  return null;
}

// ---------------------------------------------------------------------------
// Anthropic token validation — verify token works before creating a session
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface TokenValidationResult {
  valid: boolean;
  error?: string;
  oauthToken?: string | null;
}

/**
 * Validate that we can reach Claude/Anthropic with the current credentials.
 * - OAuth tokens (sk-ant-oat01-*): checked using `expiresAt` from keychain
 *   credential metadata. Always reads fresh from keychain to get the latest
 *   token (Claude Code CLI refreshes tokens automatically).
 * - API keys: validated via a minimal Anthropic API call.
 */
export async function validateAnthropicAccess(): Promise<TokenValidationResult> {
  const config = getConfig();

  // Prefer file-based token (refreshed by host-side script) over env var / config
  // because env vars get stale when the token rotates, but the file is always fresh.
  const fileToken = getOAuthTokenFromFile();
  const oauthToken = fileToken || config.llm.oauth_token;

  if (oauthToken) {
    const source = fileToken ? 'mounted file' : 'config/env';
    console.log(`[ContainerManager] Found OAuth token from ${source}, validating...`);

    // sk-ant-oat01-* tokens work with x-api-key header against Anthropic API
    const result = await testApiKey(oauthToken);
    if (result.valid) {
      return { valid: true, oauthToken };
    }

    return {
      valid: false,
      error: result.error || `Claude OAuth token (from ${source}) is invalid or expired. Run \`./scripts/refresh-oauth-token.sh\` to update.`,
    };
  }

  // API key path
  const apiKey = config.llm.api_key;
  if (!apiKey || apiKey.startsWith('CHANGE_ME')) {
    return { valid: false, error: 'No Anthropic API key configured. Set llm.api_key in config or MEGH_LLM_API_KEY environment variable.' };
  }

  const result = await testApiKey(apiKey);
  if (result.valid) {
    return { valid: true, oauthToken: null };
  }

  return {
    valid: false,
    error: result.error || 'Anthropic API key is invalid. Please check your configuration.',
  };
}

/**
 * Validate an API key by making a minimal request to the Anthropic API.
 */
async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      return { valid: true };
    }

    const body = await res.json().catch(() => ({})) as Record<string, any>;
    const apiError = body?.error?.message || res.statusText;

    if (res.status === 401) {
      return { valid: false, error: `Authentication failed: ${apiError}` };
    }
    if (res.status === 403) {
      return { valid: false, error: `Access denied: ${apiError}` };
    }

    // 429, 500, 529 etc — Anthropic is reachable but busy/overloaded.
    // The token itself is valid, so allow session creation.
    if (res.status === 429 || res.status >= 500) {
      console.warn(`[ContainerManager] Anthropic returned ${res.status} during validation — token is valid but API may be under load`);
      return { valid: true };
    }

    return { valid: false, error: `Anthropic API error (${res.status}): ${apiError}` };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { valid: false, error: 'Could not reach Anthropic API (request timed out). Please check your network connection.' };
    }
    return { valid: false, error: `Could not reach Anthropic API: ${err.message}` };
  }
}

const CONTAINER_PORTS = [3000, 5173, 8080] as const;
const PORT_KEY_PREFIX = 'port:';
const PORT_TTL_SECONDS = 7200; // 2 hours

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

export async function allocatePort(): Promise<number> {
  const config = getConfig();
  const redis = getRedis();
  const { start, end } = config.containers.port_range;

  for (let port = start; port <= end; port++) {
    const key = `${PORT_KEY_PREFIX}${port}`;
    const result = await redis.set(key, '1', 'EX', PORT_TTL_SECONDS, 'NX');
    if (result === 'OK') {
      return port;
    }
  }

  throw new Error('No available ports in the configured range');
}

export async function releasePort(port: number): Promise<void> {
  const redis = getRedis();
  await redis.del(`${PORT_KEY_PREFIX}${port}`);
}

// ---------------------------------------------------------------------------
// Memory parsing helper
// ---------------------------------------------------------------------------

export function parseMemory(mem: string): number {
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*(g|m)$/i);
  if (!match) {
    throw new Error(`Invalid memory string: "${mem}". Expected format like "2g" or "512m".`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === 'g') {
    return value * 1024 * 1024 * 1024;
  }
  return value * 1024 * 1024;
}

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

export interface CreateContainerOpts {
  sessionId: string;
  userId: string;
  proxyPort: number;
  ttlMinutes: number;
  /** Pre-validated OAuth token (if available) — avoids re-reading a stale cache */
  validatedOAuthToken?: string | null;
}

export interface CreateContainerResult {
  containerId: string;
  portMappings: Record<number, number>;
}

export async function createContainer(
  opts: CreateContainerOpts,
): Promise<CreateContainerResult> {
  const config = getConfig();
  const { sessionId, userId, proxyPort, ttlMinutes, validatedOAuthToken } = opts;

  const allocatedPorts: number[] = [];
  try {
    for (const _ of CONTAINER_PORTS) {
      allocatedPorts.push(await allocatePort());
    }
  } catch (err) {
    for (const p of allocatedPorts) {
      await releasePort(p);
    }
    throw err;
  }

  const portMappings: Record<number, number> = {};
  const portBindings: Record<string, { HostPort: string }[]> = {};
  const exposedPorts: Record<string, Record<string, never>> = {};

  CONTAINER_PORTS.forEach((containerPort, idx) => {
    const hostPort = allocatedPorts[idx];
    portMappings[containerPort] = hostPort;
    portBindings[`${containerPort}/tcp`] = [{ HostPort: String(hostPort) }];
    exposedPorts[`${containerPort}/tcp`] = {};
  });

  // Build environment variables for the container
  const env: string[] = [`SESSION_ID=${sessionId}`];

  // Use pre-validated token if provided, otherwise fall back to config/file
  const oauthToken = validatedOAuthToken ?? (config.llm.oauth_token || getOAuthTokenFromFile());

  if (oauthToken) {
    // OAuth: container talks directly to Anthropic
    env.push(`CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`);
  } else {
    // API key: route through usage proxy for token-level tracking
    env.push(`ANTHROPIC_BASE_URL=http://host.docker.internal:${proxyPort}`);
    env.push(`ANTHROPIC_API_KEY=megh-session-${sessionId}`);
    if (config.llm.api_key && !config.llm.api_key.startsWith('CHANGE_ME')) {
      env.push(`ANTHROPIC_API_KEY=${config.llm.api_key}`);
    }
  }

  // Verify image exists before creating container (6.5)
  try {
    const images = await docker.listImages({ filters: { reference: [config.containers.image] } });
    if (images.length === 0) {
      throw new Error(`Container image '${config.containers.image}' not found. Build it first with: docker build -t ${config.containers.image} containers/`);
    }
  } catch (err: any) {
    if (err.message?.includes('not found')) throw err;
    // Docker API error — let createContainer handle it
  }

  const container = await docker.createContainer({
    Image: config.containers.image,
    Env: env,
    ExposedPorts: exposedPorts,
    Labels: {
      'megh.session': sessionId,
      'megh.user': userId,
    },
    // Agent container health check (6.4)
    Healthcheck: {
      Test: ['CMD-SHELL', 'test -f /tmp/_megh_init_done || test -f /tmp/_can_init_done'],
      Interval: 30_000_000_000, // 30s in nanoseconds
      Timeout: 5_000_000_000,
      Retries: 3,
      StartPeriod: 60_000_000_000, // 60s startup grace
    },
    HostConfig: {
      NanoCpus: config.containers.cpu * 1e9,
      Memory: parseMemory(config.containers.memory),
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE', 'FOWNER'],
      SecurityOpt: ['no-new-privileges'],
      PortBindings: portBindings,
      // Network isolation: containers go on the isolated network (6.2)
      NetworkMode: 'megh_containers',
    },
  });

  return {
    containerId: container.id,
    portMappings,
  };
}

export async function startContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.start();
  // The entrypoint.sh handles Claude Code initialization (runs claude -p,
  // patches config). We wait for it to finish by polling for the marker.
  await waitForInit(containerId, 30_000);
}

async function waitForInit(containerId: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const logs = await execCommand(containerId, [
        '/bin/bash', '-c', 'cat /tmp/_megh_init_done 2>/dev/null || true',
      ]);
      if (logs.includes('ready')) {
        console.log('[ContainerManager] Container init complete');
        return;
      }
    } catch {
      // Container may not be ready for exec yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn('[ContainerManager] Container init timed out, proceeding anyway');
}

export async function stopContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: 2 });
  } catch (err: any) {
    if (!err.message?.includes('already stopped') && !err.message?.includes('not running')) {
      throw err;
    }
  }
}

export async function removeContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.remove({ force: true, v: true });
}

// ---------------------------------------------------------------------------
// Exec helpers
// ---------------------------------------------------------------------------

export async function execCommand(
  containerId: string,
  cmd: string[],
): Promise<string> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    stream.on('error', reject);
  });
}

export interface InteractiveExecResult {
  stream: NodeJS.ReadWriteStream;
  exec: Docker.Exec;
}

export async function execInteractive(
  containerId: string,
): Promise<InteractiveExecResult> {
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: ['/bin/bash'],
    Tty: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    User: 'agent',
  });

  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });

  return { stream, exec };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function pingDocker(): Promise<void> {
  await docker.ping();
}

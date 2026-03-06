import Docker from 'dockerode';
import { execSync } from 'child_process';
import { getConfig } from '../config.js';
import { getRedis } from '../db/redis.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ---------------------------------------------------------------------------
// macOS Keychain fallback for OAuth token (dev environments)
// ---------------------------------------------------------------------------

let cachedKeychainToken: string | null | undefined;

function getKeychainOAuthToken(): string | null {
  if (cachedKeychainToken !== undefined) return cachedKeychainToken;

  if (process.platform !== 'darwin') {
    cachedKeychainToken = null;
    return null;
  }

  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    const parsed = JSON.parse(raw);
    const token = parsed?.claudeAiOauth?.accessToken ?? null;
    if (token) {
      console.log('[ContainerManager] Found OAuth token in macOS Keychain');
    }
    cachedKeychainToken = token;
    return token;
  } catch {
    cachedKeychainToken = null;
    return null;
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
}

export interface CreateContainerResult {
  containerId: string;
  portMappings: Record<number, number>;
}

export async function createContainer(
  opts: CreateContainerOpts,
): Promise<CreateContainerResult> {
  const config = getConfig();
  const { sessionId, userId, proxyPort, ttlMinutes } = opts;

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

  const oauthToken = config.llm.oauth_token || getKeychainOAuthToken();

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

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve } from 'path';

export interface Config {
  platform: {
    name: string;
    domain: string;
    logo_url?: string;
  };
  llm: {
    api_key: string;
    allowed_models: string[];
    oauth_token?: string;
  };
  containers: {
    image: string;
    memory: string;
    cpu: number;
    max_concurrent: number;
    max_global_sessions: number;
    container_concurrency: number;
    port_range: { start: number; end: number };
    ttl_default: number;
    grace_period: number;
    session_rate_limit: number;
    min_balance: number;
    queue_timeout: number;
  };
  billing: {
    stripe_secret_key: string;
    stripe_publishable_key: string;
    stripe_webhook_secret: string;
    razorpay_key_id: string;
    razorpay_key_secret: string;
    razorpay_webhook_secret: string;
    default_currency: string;
    supported_currencies: string[];
    exchange_rates: Record<string, number>;
    markup_multiplier: number;
    trial_credits: number;
    model_rates: Record<string, { input: number; output: number }>;
  };
  auth: {
    jwt_secret: string;
    jwt_expiry: string;
  };
  uploads: {
    max_file_size: number;
    max_workspace_size: number;
    max_file_count: number;
  };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  proxy: {
    port: number;
    rate_limit: number;
  };
  server: {
    port: number;
    cors_origins: string[];
  };
}

const DEFAULTS: Config = {
  platform: {
    name: 'Megh',
    domain: 'localhost',
  },
  llm: {
    api_key: '',
    allowed_models: ['claude-sonnet-4-20250514'],
    oauth_token: '',
  },
  containers: {
    image: 'megh-agent:latest',
    memory: '2g',
    cpu: 1,
    max_concurrent: 3,
    max_global_sessions: 20,
    container_concurrency: 2,
    port_range: { start: 8100, end: 8200 },
    ttl_default: 120,
    grace_period: 15,
    session_rate_limit: 3,
    min_balance: 0.50,
    queue_timeout: 30,
  },
  billing: {
    stripe_secret_key: '',
    stripe_publishable_key: '',
    stripe_webhook_secret: '',
    razorpay_key_id: '',
    razorpay_key_secret: '',
    razorpay_webhook_secret: '',
    default_currency: 'USD',
    supported_currencies: ['USD', 'INR'],
    exchange_rates: { INR: 83 },
    markup_multiplier: 2.0,
    trial_credits: 2.0,
    model_rates: {
      'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
      'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
    },
  },
  auth: {
    jwt_secret: '',
    jwt_expiry: '24h',
  },
  uploads: {
    max_file_size: 200 * 1024 * 1024,
    max_workspace_size: 1024 * 1024 * 1024,
    max_file_count: 10000,
  },
  database: {
    host: 'localhost',
    port: 5432,
    database: 'can',
    user: 'can',
    password: '',
  },
  redis: {
    host: 'localhost',
    port: 6379,
    password: '',
  },
  proxy: {
    port: 8787,
    rate_limit: 60,
  },
  server: {
    port: 3000,
    cors_origins: ['http://localhost:3001'],
  },
};

function deepMerge<T extends Record<string, unknown>>(defaults: T, overrides: Record<string, unknown>): T {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof (defaults as Record<string, unknown>)[key] === 'object' &&
      !Array.isArray((defaults as Record<string, unknown>)[key])
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        (defaults as Record<string, unknown>)[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

function validateConfig(config: Config): void {
  const errors: string[] = [];

  if (!config.llm.api_key) {
    errors.push('llm.api_key is required');
  }
  if (!config.auth.jwt_secret || config.auth.jwt_secret === 'CHANGE_ME_TO_A_RANDOM_STRING') {
    errors.push('auth.jwt_secret must be set to a secure random string');
  }
  if (config.auth.jwt_secret && config.auth.jwt_secret.length < 32) {
    errors.push('auth.jwt_secret must be at least 32 characters');
  }
  if (!config.database.password || config.database.password === 'CHANGE_ME') {
    errors.push('database.password must be set');
  }
  if (config.containers.port_range.start >= config.containers.port_range.end) {
    errors.push('containers.port_range.start must be less than end');
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

let _config: Config | null = null;

export function loadConfig(configPath?: string): Config {
  if (_config) return _config;

  const path = configPath || resolve(process.cwd(), '..', 'config.yaml');
  let raw: Record<string, unknown>;

  try {
    const content = readFileSync(path, 'utf-8');
    raw = parse(content) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found at ${path}. Copy config.example.yaml to config.yaml`);
    }
    throw err;
  }

  const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, raw) as unknown as Config;

  // Environment variable overrides for secrets (accept both MEGH_ and legacy CAN_ prefixes)
  merged.auth.jwt_secret = process.env.MEGH_JWT_SECRET || process.env.CAN_JWT_SECRET || merged.auth.jwt_secret;
  merged.database.password = process.env.MEGH_DB_PASSWORD || process.env.CAN_DB_PASSWORD || merged.database.password;
  merged.billing.stripe_secret_key = process.env.MEGH_STRIPE_SECRET_KEY || process.env.CAN_STRIPE_SECRET_KEY || merged.billing.stripe_secret_key;
  merged.billing.stripe_webhook_secret = process.env.MEGH_STRIPE_WEBHOOK_SECRET || process.env.CAN_STRIPE_WEBHOOK_SECRET || merged.billing.stripe_webhook_secret;
  merged.billing.razorpay_key_id = process.env.MEGH_RAZORPAY_KEY_ID || merged.billing.razorpay_key_id;
  merged.billing.razorpay_key_secret = process.env.MEGH_RAZORPAY_KEY_SECRET || merged.billing.razorpay_key_secret;
  merged.billing.razorpay_webhook_secret = process.env.MEGH_RAZORPAY_WEBHOOK_SECRET || merged.billing.razorpay_webhook_secret;
  merged.llm.api_key = process.env.MEGH_LLM_API_KEY || process.env.CAN_LLM_API_KEY || merged.llm.api_key;
  merged.redis.password = process.env.MEGH_REDIS_PASSWORD || process.env.CAN_REDIS_PASSWORD || merged.redis.password;
  merged.llm.oauth_token = process.env.MEGH_OAUTH_TOKEN || process.env.CAN_OAUTH_TOKEN || merged.llm.oauth_token;

  validateConfig(merged);
  _config = merged;
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return _config;
}

// Allow overriding config in tests
export function setConfig(config: Config): void {
  _config = config;
}

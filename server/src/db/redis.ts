import IORedis from 'ioredis';

const { default: Redis } = IORedis as any;
type RedisClient = IORedis.Redis;

let redis: RedisClient | null = null;
let subscriber: RedisClient | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

export async function initRedis(redisConfig: RedisConfig): Promise<void> {
  redis = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
  }) as RedisClient;

  await new Promise<void>((resolve, reject) => {
    redis!.once('ready', () => {
      console.log('[Redis] Connected');
      resolve();
    });
    redis!.once('error', (err: Error) => {
      reject(new Error(`[Redis] Connection failed: ${err.message}`));
    });
  });
}

export function getRedis(): RedisClient {
  if (!redis) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
  }
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export async function initSubscriber(): Promise<RedisClient> {
  if (!redis) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }

  const opts = redis.options;

  subscriber = new Redis({
    host: opts.host,
    port: opts.port,
    password: opts.password || undefined,
    maxRetriesPerRequest: 3,
  }) as RedisClient;

  // Enable keyspace notifications for expired keys
  await subscriber.config('SET', 'notify-keyspace-events', 'Ex');

  // Subscribe to key-expiry events on db 0
  await subscriber.subscribe('__keyevent@0__:expired');

  console.log('[Redis] Subscriber connected — listening for key expirations');
  return subscriber;
}

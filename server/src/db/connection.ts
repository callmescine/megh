import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function initPool(dbConfig: DbConfig): void {
  pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });
}

export async function testConnection(): Promise<void> {
  const client = getPool();
  try {
    await client.query('SELECT 1');
    console.log('[DB] Connection verified');
  } catch (err) {
    console.error('[DB] Connection test failed:', err);
    throw err;
  }
}

export async function query(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult> {
  return getPool().query(text, params);
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.');
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

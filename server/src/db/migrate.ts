import { readdir, readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query('SELECT filename FROM _migrations ORDER BY id');
  return new Set(result.rows.map((row: { filename: string }) => row.filename));
}

async function getMigrationFiles(): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(MIGRATIONS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn('[Migrate] No migrations directory found at', MIGRATIONS_DIR);
      return [];
    }
    throw err;
  }

  return files
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Parse UP and DOWN sections from a migration file.
 * Convention: `-- UP` marks the start of the up migration (default if no markers).
 * `-- DOWN` marks the start of the down migration.
 */
function parseMigrationSections(sql: string): { up: string; down: string } {
  const upMatch = sql.indexOf('-- UP');
  const downMatch = sql.indexOf('-- DOWN');

  if (upMatch === -1 && downMatch === -1) {
    // No markers — entire file is the UP migration
    return { up: sql, down: '' };
  }

  let up = '';
  let down = '';

  if (upMatch !== -1 && downMatch !== -1) {
    if (upMatch < downMatch) {
      up = sql.slice(upMatch + '-- UP'.length, downMatch).trim();
      down = sql.slice(downMatch + '-- DOWN'.length).trim();
    } else {
      down = sql.slice(downMatch + '-- DOWN'.length, upMatch).trim();
      up = sql.slice(upMatch + '-- UP'.length).trim();
    }
  } else if (upMatch !== -1) {
    up = sql.slice(upMatch + '-- UP'.length).trim();
  } else {
    down = sql.slice(downMatch + '-- DOWN'.length).trim();
  }

  // Remove commented-out lines in DOWN section (lines starting with --)
  down = down
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      // Uncomment lines that start with "-- " followed by SQL
      if (trimmed.startsWith('-- ') && /^-- \s*(DROP|ALTER|DELETE|UPDATE|CREATE)/i.test(trimmed)) {
        return trimmed.slice(3);
      }
      return line;
    })
    .join('\n')
    .trim();

  return { up, down };
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = await getMigrationFiles();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[Migrate] All migrations up to date');
    return;
  }

  console.log(`[Migrate] Running ${pending.length} pending migration(s)...`);

  for (const filename of pending) {
    const filePath = resolve(MIGRATIONS_DIR, filename);
    const sql = await readFile(filePath, 'utf-8');
    const { up } = parseMigrationSections(sql);
    const migrationSql = up || sql;

    console.log(`[Migrate] Applying ${filename}...`);

    await query('BEGIN');
    try {
      await query(migrationSql);
      await query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
      await query('COMMIT');
      console.log(`[Migrate] Applied ${filename}`);
    } catch (err) {
      await query('ROLLBACK');
      console.error(`[Migrate] Failed to apply ${filename}:`, err);
      throw err;
    }
  }

  console.log('[Migrate] All migrations applied');
}

/**
 * Rollback the last applied migration (6.6).
 */
export async function rollbackMigration(): Promise<void> {
  await ensureMigrationsTable();

  // Get the last applied migration
  const result = await query(
    'SELECT filename FROM _migrations ORDER BY id DESC LIMIT 1',
  );

  if (result.rows.length === 0) {
    console.log('[Migrate] No migrations to rollback');
    return;
  }

  const filename = result.rows[0].filename;
  const filePath = resolve(MIGRATIONS_DIR, filename);

  let sql: string;
  try {
    sql = await readFile(filePath, 'utf-8');
  } catch {
    console.error(`[Migrate] Migration file not found: ${filename}`);
    return;
  }

  const { down } = parseMigrationSections(sql);

  if (!down) {
    console.error(`[Migrate] No DOWN section found in ${filename}`);
    return;
  }

  console.log(`[Migrate] Rolling back ${filename}...`);

  await query('BEGIN');
  try {
    await query(down);
    await query('DELETE FROM _migrations WHERE filename = $1', [filename]);
    await query('COMMIT');
    console.log(`[Migrate] Rolled back ${filename}`);
  } catch (err) {
    await query('ROLLBACK');
    console.error(`[Migrate] Failed to rollback ${filename}:`, err);
    throw err;
  }
}

#!/usr/bin/env npx tsx
/**
 * Seed an admin user for the Megh platform.
 * Usage: npx tsx scripts/seed-admin.ts <email> <password>
 */

import bcrypt from 'bcrypt';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve } from 'path';
import pg from 'pg';

const BCRYPT_ROUNDS = 12;

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: npx tsx scripts/seed-admin.ts <email> <password>');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Error: Password must be at least 8 characters');
    process.exit(1);
  }

  // Load config
  const scriptDir = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
  const configPath = resolve(scriptDir, '..', 'config.yaml');
  const configFile = readFileSync(configPath, 'utf-8');
  const config = parse(configFile) as {
    database: { host: string; port: number; user: string; password: string; database: string };
    billing: { trial_credits: number };
  };

  const pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  });

  try {
    // Check if user exists
    const existing = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);

    if (existing.rows.length > 0) {
      // Promote existing user to admin
      await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [existing.rows[0].id]);
      console.log(`Promoted existing user ${email} to admin (id: ${existing.rows[0].id})`);
    } else {
      // Create new admin user
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'admin')
         RETURNING id`,
        [email, passwordHash],
      );
      const userId = result.rows[0].id;

      await pool.query(
        'INSERT INTO billing_accounts (user_id, balance_usd) VALUES ($1, $2)',
        [userId, config.billing?.trial_credits ?? 2.0],
      );

      console.log(`Created admin user ${email} (id: ${userId})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

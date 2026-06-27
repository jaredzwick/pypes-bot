import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

const HERE = dirname(fileURLToPath(import.meta.url));

export type DB = BunSQLiteDatabase<typeof schema>;

export function openDb(databasePath: string): { db: DB; raw: Database } {
  const raw = new Database(databasePath, { create: true });
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA synchronous = NORMAL');

  const db = drizzle(raw, { schema });
  return { db, raw };
}

export function runMigrations(raw: Database, migrationsDir?: string): string[] {
  const dir = migrationsDir ?? findMigrationsDir();
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedRows = raw.query('SELECT version FROM schema_migrations').all() as Array<{ version: string }>;
  const applied = new Set(appliedRows.map((r) => r.version));
  const justApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    raw.transaction(() => {
      raw.exec(sql);
      raw.run('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    })();
    justApplied.push(file);
  }
  return justApplied;
}

function findMigrationsDir(): string {
  for (const candidate of [join(HERE, '..', '..', 'migrations'), join(process.cwd(), 'migrations'), '/app/migrations']) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('migrations directory not found');
}

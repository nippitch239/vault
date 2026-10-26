/**
 * Secure Vault Cloud — Dual-Engine Database Adapter
 *
 * 1. Production (AWS Lambda -> RDS PostgreSQL): one pg.Pool per Lambda container, created
 *    lazily in module scope and reused by every warm invocation. Credentials come from
 *    Secrets Manager (DB_SECRET_ARN); TLS is verified against the RDS CA bundle that the
 *    Lambda Node.js runtime ships (NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem).
 * 2. Local / tests: node:sqlite (Node >= 22.13) with JSONB / placeholder translation.
 *    node:sqlite is imported lazily so it is never loaded inside Lambda.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSecretJson, clearSecretCache } from '../config/secrets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SQLITE_PATH = path.resolve(__dirname, '../../../data.sqlite');

// Known JSON columns across schema tables
const JSON_COLUMNS = new Set([
  'encrypted_data',
  'metadata',
  'encrypted_private_key',
  'encrypted_key_for_recipient',
  'encryptedKeyForRecipient',
  'encrypted_vault_key',
  'encrypted_item_key',
  'encrypted_org_key',
  'encryptedOrgKey',
  'details',
]);

// Known Boolean columns
const BOOLEAN_COLUMNS = new Set(['mfa_enabled', 'is_shared', 'favorite']);

/**
 * Preprocess PostgreSQL DDL for SQLite in-memory execution
 * @param {string} pgDdl
 * @returns {string}
 */
export function pgToSqliteSchema(pgDdl) {
  return pgDdl
    // Remove PostgreSQL extensions
    .replace(/CREATE\s+EXTENSION[^;]+;/gi, '')
    // Wrap function calls in default constraints with parentheses: DEFAULT gen_random_uuid() -> DEFAULT (gen_random_uuid())
    .replace(/DEFAULT\s+gen_random_uuid\(\)/gi, 'DEFAULT (gen_random_uuid())')
    // Remove PostgreSQL cast notations like ::jsonb
    .replace(/::jsonb/gi, '')
    // Translate GIN index definitions to standard SQLite indexes
    .replace(/USING\s+GIN\s*\(([^)]+)\)/gi, '($1)')
    // SQLite has no ADD COLUMN IF NOT EXISTS; those upgrades run via sqliteColumnUpgrades()
    .replace(ADD_COLUMN_RE, '');
}

const ADD_COLUMN_RE = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([^;]+);/gi;

/**
 * Column upgrades from schema.sql as SQLite statements (without IF NOT EXISTS).
 * @param {string} pgDdl
 * @returns {{ table: string, column: string, sql: string }[]}
 */
export function sqliteColumnUpgrades(pgDdl) {
  return [...pgDdl.matchAll(ADD_COLUMN_RE)].map(([, table, definition]) => {
    const def = definition
      .replace(/::jsonb/gi, '')
      .replace(/DEFAULT\s+gen_random_uuid\(\)/gi, 'DEFAULT (gen_random_uuid())')
      .trim();
    return { table, column: def.split(/\s+/)[0], sql: `ALTER TABLE ${table} ADD COLUMN ${def}` };
  });
}

/**
 * Translates PostgreSQL parameterized query ($1, $2) and JSONB operators (->>, ->) for SQLite
 * @param {string} sql
 * @param {any[]} params
 * @returns {{ sql: string, params: any[] }}
 */
export function translateQueryForSqlite(sql, params = []) {
  // 1. Translate JSON operators:
  // e.g., metadata->>'title' -> json_extract(metadata, '$.title')
  let translatedSql = sql.replace(
    /([a-zA-Z0-9_]+)->>'([a-zA-Z0-9_]+)'/g,
    "json_extract($1, '$.' || '$2')"
  );
  translatedSql = translatedSql.replace(
    /([a-zA-Z0-9_]+)->'([a-zA-Z0-9_]+)'/g,
    "json_extract($1, '$.' || '$2')"
  );

  // Translate PostgreSQL ILIKE to SQLite case-insensitive LIKE
  translatedSql = translatedSql.replace(/\bILIKE\b/gi, 'LIKE');

  // 2. Translate $1, $2 parameter placeholders to ? in sequential order
  const translatedParams = [];
  if (/\$([0-9]+)/.test(translatedSql)) {
    translatedSql = translatedSql.replace(/\$([0-9]+)/g, (_, idx) => {
      const i = parseInt(idx, 10) - 1;
      translatedParams.push(params[i]);
      return '?';
    });
  } else {
    translatedParams.push(...params);
  }

  // 3. Normalize parameter types for SQLite DatabaseSync
  const normalizedParams = translatedParams.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'object' && !Buffer.isBuffer(p) && !(p instanceof Uint8Array)) {
      return JSON.stringify(p);
    }
    return p;
  });

  return { sql: translatedSql, params: normalizedParams };
}

/**
 * Deserializes JSON and boolean fields in SQLite result rows for PostgreSQL API parity
 * @param {Record<string, any>} row
 * @returns {Record<string, any>}
 */
export function normalizeSqliteRow(row) {
  if (!row) return row;
  const normalized = { ...row };
  for (const [key, value] of Object.entries(normalized)) {
    if (value === null || value === undefined) continue;

    // Parse JSON columns
    if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      try {
        normalized[key] = JSON.parse(value);
      } catch {
        // Keep string if parsing fails
      }
    }

    // Convert booleans
    if (BOOLEAN_COLUMNS.has(key) && typeof value === 'number') {
      normalized[key] = value === 1;
    }
  }
  return normalized;
}

/**
 * SQLite database for local development and tests.
 */
export class SqliteDatabase {
  constructor(location = ':memory:') {
    this.type = 'sqlite';
    this.location = location;
    this.db = null;
    this.ready = this.#open();
  }

  async #open() {
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(this.location);
    this.db.function('gen_random_uuid', () => crypto.randomUUID());
    this.db.exec('PRAGMA foreign_keys = ON;');
    const ddl = readSchema();

    // Pre-DDL upgrade: If an existing database has tables missing new columns,
    // add them before executing DDL indexes to avoid "no such column" index errors.
    for (const { table, column, sql } of sqliteColumnUpgrades(ddl)) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (columns.length > 0 && !columns.some((c) => c.name === column)) this.db.exec(sql);
    }

    this.db.exec(pgToSqliteSchema(ddl));
    for (const { table, column, sql } of sqliteColumnUpgrades(ddl)) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((c) => c.name === column)) this.db.exec(sql);
    }
  }

  async query(sql, params = []) {
    await this.ready;
    const { sql: translatedSql, params: normalizedParams } = translateQueryForSqlite(sql, params);

    const cleanedSql = translatedSql.replace(/^(\s*(--[^\n]*\r?\n|\/\*[\s\S]*?\*\/))*/g, '');
    const isSelect = /^\s*(?:SELECT|WITH)\b/i.test(cleanedSql);
    const hasReturning = /\bRETURNING\b/i.test(translatedSql);

    try {
      const stmt = this.db.prepare(translatedSql);
      if (isSelect || hasReturning) {
        const rows = stmt.all(...normalizedParams).map(normalizeSqliteRow);
        return { rows, rowCount: rows.length };
      }
      const result = stmt.run(...normalizedParams);
      return { rows: [], rowCount: result.changes ?? 0 };
    } catch (err) {
      // Keep the SQL for local debugging; the router never sends error messages to clients.
      const error = new Error(`SQLite Query Error: ${err.message}\nSQL: ${translatedSql}`);
      error.originalError = err;
      error.code = err.code;
      error.isUniqueViolation = /UNIQUE constraint failed/i.test(err.message);
      error.isForeignKeyViolation = /FOREIGN KEY constraint failed/i.test(err.message);
      throw error;
    }
  }

  /**
   * Runs fn inside BEGIN/COMMIT. node:sqlite has a single connection, so this is only
   * meant for local development / tests.
   */
  async transaction(fn) {
    await this.ready;
    this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(ddlSql) {
    await this.ready;
    this.db.exec(ddlSql);
  }

  async close() {
    await this.ready;
    this.db.close();
  }
}

/**
 * Resolves pg.Pool options. Order: DB_SECRET_ARN (Secrets Manager) > DATABASE_URL.
 */
export async function resolvePgConfig() {
  const ssl = process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: true };
  const common = {
    max: Number(process.env.DB_POOL_MAX || 2),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 10000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5000),
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 8000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 9000),
    ssl,
  };

  if (process.env.DB_SECRET_ARN) {
    const secret = await getSecretJson(process.env.DB_SECRET_ARN);
    return {
      ...common,
      host: process.env.DB_HOST || secret.host,
      port: Number(process.env.DB_PORT || secret.port || 5432),
      database: process.env.DB_NAME || secret.dbname || 'securevault',
      user: secret.username,
      password: secret.password,
    };
  }
  if (process.env.DATABASE_URL) {
    return { ...common, connectionString: process.env.DATABASE_URL };
  }
  throw new Error('Database is not configured: set DB_SECRET_ARN (+ DB_HOST) or DATABASE_URL');
}

const PG_AUTH_FAILED = '28P01';

/**
 * PostgreSQL (Amazon RDS) implementation.
 */
export class PostgresDatabase {
  constructor(options = {}) {
    this.type = 'postgres';
    this.options = options;
    this.poolPromise = null;
  }

  async getPool() {
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        const pgModule = await import('pg');
        const { Pool } = pgModule.default || pgModule;
        const pool = new Pool({ ...(await resolvePgConfig()), ...this.options });
        // An idle client erroring (e.g. RDS failover) must not crash the container.
        pool.on('error', (err) => console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: err.message })));
        return pool;
      })().catch((err) => {
        this.poolPromise = null;
        throw err;
      });
    }
    return this.poolPromise;
  }

  async #resetOnAuthFailure(err) {
    if (err?.code === PG_AUTH_FAILED) {
      clearSecretCache();
      const pool = await this.poolPromise?.catch(() => null);
      this.poolPromise = null;
      await pool?.end().catch(() => {});
    }
  }

  static #mapError(err) {
    err.isUniqueViolation = err.code === '23505';
    err.isForeignKeyViolation = err.code === '23503';
    return err;
  }

  async query(sql, params = []) {
    const pool = await this.getPool();
    try {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    } catch (err) {
      await this.#resetOnAuthFailure(err);
      throw PostgresDatabase.#mapError(err);
    }
  }

  async transaction(fn) {
    const pool = await this.getPool();
    const client = await pool.connect();
    const tx = {
      type: 'postgres',
      query: async (sql, params = []) => {
        try {
          const result = await client.query(sql, params);
          return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
        } catch (err) {
          throw PostgresDatabase.#mapError(err);
        }
      },
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async exec(ddlSql) {
    const pool = await this.getPool();
    await pool.query(ddlSql);
  }

  async close() {
    const pool = await this.poolPromise?.catch(() => null);
    this.poolPromise = null;
    await pool?.end();
  }
}

export function readSchema() {
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
}

/**
 * Applies schema.sql (idempotent: CREATE ... IF NOT EXISTS) and migrates personal organizations.
 */
export async function initSchema(database) {
  if (database.type === 'sqlite') {
    await database.ready;
  } else {
    await database.exec(readSchema());
  }
  const { migratePersonalOrganizations } = await import('./migration.js');
  return migratePersonalOrganizations(database);
}

function useSqlite() {
  return !process.env.DB_SECRET_ARN && !process.env.DATABASE_URL;
}

export function createDatabase(config = {}) {
  const engine = config.engine || (useSqlite() ? 'sqlite' : 'postgres');
  if (engine === 'postgres') {
    return new PostgresDatabase(config.pool);
  }
  const isTest =
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (process.execArgv && process.execArgv.includes('--test'));
  const location = config.location || process.env.SQLITE_DB_PATH || (isTest ? ':memory:' : DEFAULT_SQLITE_PATH);
  return new SqliteDatabase(location);
}

// Module scope => one instance (and one pg pool) per Lambda container.
let globalDbInstance = null;

export function getDatabase(config = {}) {
  if (!globalDbInstance) {
    globalDbInstance = createDatabase(config);
  }
  return globalDbInstance;
}

/**
 * Closes and recreates the global instance (tests).
 */
export async function resetDatabase(config = {}) {
  if (globalDbInstance) {
    try {
      await globalDbInstance.close();
    } catch {
      // ignore
    }
    globalDbInstance = null;
  }
  const db = getDatabase(config);
  if (db.ready) await db.ready;
  return db;
}

export default getDatabase;

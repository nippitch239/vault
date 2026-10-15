/**
 * Secure Vault Cloud — Dual-Engine Database Adapter (IDatabase)
 *
 * Implements:
 * 1. Local Simulation Engine: In-memory node:sqlite (DatabaseSync from Node 22 native stdlib)
 *    with automatic JSONB translation (->> to json_extract) and zero external dependencies.
 * 2. Production Engine: PostgreSQL driver connection pooling (pg.Pool) for Amazon RDS.
 * 3. Auto-initialization of schema tables from schema.sql on startup.
 *
 * Ponytail minimalism: Native Node 22 stdlib first, zero external database dependencies for local dev.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    .replace(/USING\s+GIN\s*\(([^)]+)\)/gi, '($1)');
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
 * SQLite Local In-Memory Database Implementation
 */
export class SqliteDatabase {
  constructor(location = ':memory:') {
    this.type = 'sqlite';
    this.location = location;
    this.db = new DatabaseSync(location);

    // Register PostgreSQL compatibility functions
    this.db.function('gen_random_uuid', () => crypto.randomUUID());

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  /**
   * Execute parameterized query
   * @param {string} sql
   * @param {any[]} params
   * @returns {Promise<{ rows: any[], rowCount: number }>}
   */
  async query(sql, params = []) {
    const { sql: translatedSql, params: normalizedParams } = translateQueryForSqlite(sql, params);

    // Check if query produces a result set (SELECT, WITH ... SELECT, or has RETURNING)
    const cleanedSql = translatedSql.replace(/^(\s*(--[^\n]*\r?\n|\/\*[\s\S]*?\*\/))*/g, '');
    const isSelect = /^\s*(?:SELECT|WITH)\b/i.test(cleanedSql);
    const hasReturning = /\bRETURNING\b/i.test(translatedSql);

    try {
      const stmt = this.db.prepare(translatedSql);

      if (isSelect || hasReturning) {
        const rawRows = stmt.all(...normalizedParams);
        const rows = rawRows.map(normalizeSqliteRow);
        return {
          rows,
          rowCount: rows.length,
        };
      } else {
        const result = stmt.run(...normalizedParams);
        return {
          rows: [],
          rowCount: result.changes ?? 0,
          lastInsertRowid: result.lastInsertRowid,
        };
      }
    } catch (err) {
      // Enhance error message with query context for debugging
      const error = new Error(`SQLite Query Error: ${err.message}\nSQL: ${translatedSql}`);
      error.originalError = err;
      error.code = err.code;
      throw error;
    }
  }

  /**
   * Execute raw SQL string directly (e.g. DDL schema)
   * @param {string} ddlSql
   */
  async exec(ddlSql) {
    this.db.exec(ddlSql);
  }

  /**
   * Close database connection
   */
  async close() {
    this.db.close();
  }
}

/**
 * PostgreSQL Production Database Implementation (RDS)
 */
export class PostgresDatabase {
  constructor(options = {}) {
    this.type = 'postgres';
    this.options = options;
    this.pool = null;
  }

  async initPool() {
    if (!this.pool) {
      const pgModule = await import('pg');
      const { Pool } = pgModule.default || pgModule;
      this.pool = new Pool({
        connectionString: this.options.connectionString || process.env.DATABASE_URL,
        max: this.options.max || 2, // Serverless concurrency limit
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 3000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      });
    }
    return this.pool;
  }

  async query(sql, params = []) {
    const pool = await this.initPool();
    const result = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  async exec(ddlSql) {
    const pool = await this.initPool();
    await pool.query(ddlSql);
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

/**
 * Initializes database schema using schema.sql
 * @param {SqliteDatabase|PostgresDatabase} database
 */
export async function initSchema(database) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const ddl = fs.readFileSync(schemaPath, 'utf8');

  if (database.type === 'sqlite') {
    const sqliteDdl = pgToSqliteSchema(ddl);
    // Split and execute statements or exec entire block
    database.exec(sqliteDdl);
  } else {
    await database.exec(ddl);
  }
}

/**
 * Factory to create database instance
 * @param {object} config
 * @returns {SqliteDatabase|PostgresDatabase}
 */
export function createDatabase(config = {}) {
  const engine = config.engine || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  if (engine === 'postgres') {
    return new PostgresDatabase(config);
  }
  const isTest =
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (process.execArgv && process.execArgv.includes('--test'));
  const defaultLocation = isTest
    ? ':memory:'
    : DEFAULT_SQLITE_PATH;
  const location = config.location || process.env.SQLITE_DB_PATH || defaultLocation;
  return new SqliteDatabase(location);
}

// Global singleton instance for local server and Lambda
let globalDbInstance = null;

/**
 * Get or initialize global database instance
 * @param {object} [config]
 * @returns {SqliteDatabase|PostgresDatabase}
 */
export function getDatabase(config = {}) {
  if (!globalDbInstance) {
    globalDbInstance = createDatabase(config);
    // Auto-initialize schema for local SQLite instance
    if (globalDbInstance.type === 'sqlite') {
      initSchema(globalDbInstance);
    }
  }
  return globalDbInstance;
}

/**
 * Resets global database instance (useful for clean test runs)
 * @param {object} [config]
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
  return getDatabase(config);
}

export default getDatabase;

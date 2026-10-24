#!/usr/bin/env node
/**
 * Applies backend/src/db/schema.sql (idempotent CREATE ... IF NOT EXISTS).
 *
 * - Local PostgreSQL:  DATABASE_URL=postgres://... DB_SSL=false npm run migrate --workspace backend
 * - AWS RDS (private subnet, no NAT): run it from inside the VPC by invoking the Lambda:
 *     aws lambda invoke --function-name securevault-api \
 *       --cli-binary-format raw-in-base64-out --payload '{"vaultTask":"migrate"}' out.json
 */

import { getDatabase, initSchema } from '../src/db/adapter.js';

const db = getDatabase();
if (db.type !== 'postgres') {
  console.error('Set DATABASE_URL (or DB_SECRET_ARN + DB_HOST) to migrate a PostgreSQL database.');
  process.exit(1);
}
await initSchema(db);
await db.close();
console.log('Schema applied.');

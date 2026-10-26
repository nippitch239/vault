/**
 * AWS Lambda entry point (handler: lambda.handler).
 *
 * Anything at module scope (DB pool, cached secrets) survives between warm invocations.
 *
 * Besides API Gateway events the function accepts one operational event, sent only with
 * `aws lambda invoke` (IAM protected, never routed through API Gateway):
 *   { "vaultTask": "migrate" }  -> applies schema.sql to RDS from inside the VPC.
 *   { "vaultTask": "reset", "confirm": "DROP ALL DATA" }
 *                               -> drops every table in the public schema, then migrates.
 *                                  Used once to replace an older schema (all data is lost).
 */

import { router } from './router.js';
import { getDatabase, initSchema } from './db/adapter.js';

export async function handler(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;

  if (event?.vaultTask === 'reset') {
    if (event.confirm !== 'DROP ALL DATA') {
      return { ok: false, task: 'reset', error: 'confirm must be "DROP ALL DATA"' };
    }
    const db = getDatabase();
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const stats = await initSchema(db);
    console.log(JSON.stringify({ level: 'warn', msg: 'database reset and schema applied', ...stats }));
    return { ok: true, task: 'reset', ...stats };
  }

  if (event?.vaultTask === 'migrate') {
    const stats = await initSchema(getDatabase());
    console.log(JSON.stringify({ level: 'info', msg: 'schema migration applied', ...stats }));
    return { ok: true, task: 'migrate', ...stats };
  }

  return router(event, context);
}

export default handler;

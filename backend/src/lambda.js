/**
 * AWS Lambda entry point (handler: lambda.handler).
 *
 * Anything at module scope (DB pool, cached secrets) survives between warm invocations.
 *
 * Besides API Gateway events the function accepts one operational event, sent only with
 * `aws lambda invoke` (IAM protected, never routed through API Gateway):
 *   { "vaultTask": "migrate" }  -> applies schema.sql to RDS from inside the VPC.
 */

import { router } from './router.js';
import { getDatabase, initSchema } from './db/adapter.js';

export async function handler(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;

  if (event?.vaultTask === 'migrate') {
    const stats = await initSchema(getDatabase());
    console.log(JSON.stringify({ level: 'info', msg: 'schema migration applied', ...stats }));
    return { ok: true, task: 'migrate', ...stats };
  }

  return router(event, context);
}

export default handler;

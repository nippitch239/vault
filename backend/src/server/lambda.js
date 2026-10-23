/**
 * Secure Vault Cloud — AWS Lambda entry point
 *
 * Handler setting in Lambda: src/server/lambda.handler
 *
 * On cold start:
 * 1. Loads DB credentials (RDS-managed secret) and JWT secret from Secrets Manager.
 * 2. Builds DATABASE_URL, then imports the router (auth-guard reads JWT_SECRET at import time).
 * 3. Optionally creates tables from schema.sql when INIT_SCHEMA=true.
 *
 * Env vars: DB_SECRET_ARN, DB_HOST, DB_NAME, DB_PORT, JWT_SECRET_ARN, INIT_SCHEMA, NODE_ENV=production
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});

async function getSecret(arn) {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  return res.SecretString;
}

async function bootstrap() {
  if (process.env.DB_SECRET_ARN && !process.env.DATABASE_URL) {
    const { username, password } = JSON.parse(await getSecret(process.env.DB_SECRET_ARN));
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || '5432';
    const db = process.env.DB_NAME || 'postgres';
    process.env.DATABASE_URL =
      `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  if (process.env.JWT_SECRET_ARN && !process.env.JWT_SECRET) {
    process.env.JWT_SECRET = await getSecret(process.env.JWT_SECRET_ARN);
  }

  const { router } = await import('./router.js');
  const { getDatabase, initSchema } = await import('./db/adapter.js');
  if (process.env.INIT_SCHEMA === 'true') {
    await initSchema(getDatabase());
  }
  return router;
}

let ready = null;

export async function handler(event, context) {
  ready ??= bootstrap().catch((err) => {
    ready = null; // retry on next invocation
    throw err;
  });
  const router = await ready;
  return router(event, context);
}

/**
 * Runtime secrets.
 *
 * In AWS the Lambda reads credentials from Secrets Manager through the Interface VPC
 * Endpoint (private DNS) — nothing secret is put in environment variables:
 *   DB_SECRET_ARN   RDS-managed master secret: { username, password } (+ host/port/dbname
 *                   when the secret was created by hand)
 *   APP_SECRET_ARN  application secret: { saltPepper }
 *
 * Values are cached for SECRET_CACHE_TTL_MS (default 15 min) in module scope so warm
 * invocations do not call Secrets Manager again; clearSecretCache() forces a refresh
 * (used after a DB authentication failure, e.g. right after rotation).
 */

const TTL_MS = Number(process.env.SECRET_CACHE_TTL_MS || 15 * 60 * 1000);
const cache = new Map();
let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('@aws-sdk/client-secrets-manager').then(
      ({ SecretsManagerClient }) => new SecretsManagerClient({})
    );
  }
  return clientPromise;
}

export async function getSecretJson(secretId) {
  const hit = cache.get(secretId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const client = await getClient();
  const { GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = JSON.parse(res.SecretString || '{}');
  cache.set(secretId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function clearSecretCache() {
  cache.clear();
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Pepper for deterministic pre-registration KDF salts (see handlers/users.js).
 */
export async function getSaltPepper() {
  if (process.env.APP_SECRET_ARN) {
    const secret = await getSecretJson(process.env.APP_SECRET_ARN);
    if (secret.saltPepper) return secret.saltPepper;
    throw new Error('APP_SECRET_ARN secret has no saltPepper field');
  }
  if (process.env.SALT_PEPPER) return process.env.SALT_PEPPER;
  if (isProduction()) {
    throw new Error('APP_SECRET_ARN (or SALT_PEPPER) must be configured in production');
  }
  return 'local-dev-salt-pepper-not-for-production';
}

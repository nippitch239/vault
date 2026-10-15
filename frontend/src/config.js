/* global process */
/**
 * Runtime configuration, read from Vite env variables at build time.
 * On AWS Amplify these are set in App settings -> Environment variables (see .env.example).
 *
 *   VITE_API_URL                API Gateway invoke URL incl. stage + /api/v1
 *                               e.g. https://abc123.execute-api.ap-southeast-1.amazonaws.com/prod/api/v1
 *   VITE_AUTH_MODE              "cognito" (default when a user pool is configured) or "local"
 *   VITE_COGNITO_USER_POOL_ID   e.g. ap-southeast-1_AbCdEf123
 *   VITE_COGNITO_CLIENT_ID      App client id (public client, no secret)
 *   VITE_LOCAL_AUTH_URL         local Cognito emulator base (dev only, default /local-auth)
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const nodeEnv = (typeof process !== 'undefined' && process.env) || {};

function read(name, fallback = '') {
  return env[name] ?? nodeEnv[name] ?? fallback;
}

export const config = {
  apiUrl: read('VITE_API_URL', read('VITE_API_BASE_URL', '/api/v1')).replace(/\/$/, ''),
  cognito: {
    userPoolId: read('VITE_COGNITO_USER_POOL_ID'),
    userPoolClientId: read('VITE_COGNITO_CLIENT_ID'),
  },
  localAuthUrl: read('VITE_LOCAL_AUTH_URL', '/local-auth').replace(/\/$/, ''),
};

config.authMode = read('VITE_AUTH_MODE') || (config.cognito.userPoolId ? 'cognito' : 'local');

export default config;

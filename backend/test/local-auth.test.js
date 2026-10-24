/**
 * Local Cognito emulator (dev/test only): sign-up, TOTP challenge, forgot password, lockout.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase } from '../src/db/adapter.js';
import { handleLocalAuth, resetLocalAuthStore, generateTotp, verifyIdToken } from '../local/local-auth.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

async function call(action, body = {}, token) {
  const res = await handleLocalAuth(action, body, token ? { authorization: `Bearer ${token}` } : {});
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('local Cognito: sign-up, confirmation, TOTP challenge and ID token claims', async () => {
  await resetDatabase();
  resetLocalAuthStore();
  process.env.LOCAL_ADMIN_USERS = 'root_admin';

  const up = await call('sign-up', { username: 'root_admin', email: 'root@example.com', password: 'Aa1!0123456789' });
  assert.equal(up.status, 200);
  assert.equal((await call('sign-up', { username: 'ROOT_ADMIN', email: 'x@example.com', password: 'Aa1!0123456789' })).data.error, 'UsernameExistsException');

  assert.equal((await call('sign-in', { username: 'root_admin', password: 'Aa1!0123456789' })).data.error, 'UserNotConfirmedException');
  assert.equal((await call('confirm-sign-up', { username: 'root_admin', code: '000000' })).data.error, 'CodeMismatchException');
  assert.equal((await call('confirm-sign-up', { username: 'root_admin', code: up.data.devCode })).status, 200);

  const signIn = await call('sign-in', { username: 'root@example.com', password: 'Aa1!0123456789' });
  assert.equal(signIn.data.nextStep, 'DONE');
  const claims = verifyIdToken(signIn.data.idToken);
  assert.equal(claims['cognito:username'], 'root_admin');
  assert.deepEqual(claims['cognito:groups'], ['admin']);
  assert.equal(claims.token_use, 'id');

  // TOTP enrolment
  const setup = await call('totp/setup', {}, signIn.data.idToken);
  assert.ok(setup.data.sharedSecret);
  assert.equal((await call('totp/verify', { code: '000000' }, signIn.data.idToken)).status, 400);
  assert.equal((await call('totp/verify', { code: generateTotp(setup.data.sharedSecret) }, signIn.data.idToken)).status, 200);

  // Next sign-in requires the TOTP code
  const challenge = await call('sign-in', { username: 'root_admin', password: 'Aa1!0123456789' });
  assert.equal(challenge.data.nextStep, 'CONFIRM_SIGN_IN_WITH_TOTP_CODE');
  assert.equal((await call('confirm-sign-in', { session: challenge.data.session, code: '999999' })).status, 400);
  const done = await call('confirm-sign-in', { session: challenge.data.session, code: generateTotp(setup.data.sharedSecret) });
  assert.equal(done.data.nextStep, 'DONE');
  assert.ok(verifyIdToken(done.data.idToken).sub);
});

test('local Cognito: forgot password and lockout after 5 failed sign-ins', async () => {
  await resetDatabase();
  resetLocalAuthStore();

  const up = await call('sign-up', { username: 'dana', email: 'dana@example.com', password: 'Aa1!old-password' });
  await call('confirm-sign-up', { username: 'dana', code: up.data.devCode });

  // Unknown user gets the same response (no enumeration)
  const unknown = await call('forgot-password', { username: 'nobody' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.devCode, undefined);

  const forgot = await call('forgot-password', { username: 'dana' });
  assert.equal((await call('confirm-forgot-password', { username: 'dana', code: '111111', newPassword: 'Aa1!new-password' })).status, 400);
  assert.equal((await call('confirm-forgot-password', { username: 'dana', code: forgot.data.devCode, newPassword: 'Aa1!new-password' })).status, 200);
  assert.equal((await call('sign-in', { username: 'dana', password: 'Aa1!old-password' })).data.error, 'NotAuthorizedException');
  assert.equal((await call('sign-in', { username: 'dana', password: 'Aa1!new-password' })).data.nextStep, 'DONE');

  for (let i = 0; i < 5; i++) {
    await call('sign-in', { username: 'dana', password: 'wrong-password' });
  }
  const locked = await call('sign-in', { username: 'dana', password: 'Aa1!new-password' });
  assert.equal(locked.data.message, 'Password attempts exceeded');
});

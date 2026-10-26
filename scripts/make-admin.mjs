#!/usr/bin/env node
/**
 * Prints AWS CLI commands that create a confirmed Cognito admin user without the sign-up form.
 *
 * The Cognito password is not the master password: it is "Sv1!" + authHash, where authHash is
 * derived from the master password with Argon2id and the salt the API hands out for that username.
 * This script computes it locally (the master password never leaves this machine) and prints
 * the commands to paste into CloudShell.
 *
 * Usage: node scripts/make-admin.mjs <api-url> <user-pool-id> <username> <email>
 *        (prompts for the master password)
 *
 * Log in on the website with the USERNAME (not the email) the first time: the first login
 * creates the vault profile (Vault Key, RSA key pair) in the browser.
 */

import readline from 'node:readline';
import { deriveMasterKeys, toCognitoPassword } from '../shared/crypto.js';

const [apiUrl, poolId, username, email] = process.argv.slice(2);
if (!apiUrl || !poolId || !username || !email) {
  console.error('Usage: node scripts/make-admin.mjs <api-url> <user-pool-id> <username> <email>');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await askHidden('Master password: ');
if (password.length < 12) {
  console.error('Master password must be at least 12 characters');
  process.exit(1);
}

const res = await fetch(`${apiUrl.replace(/\/$/, '')}/auth/salt?identifier=${encodeURIComponent(username)}`);
const salt = (await res.json())?.data?.salt;
if (!salt) {
  console.error(`Could not get salt from the API (HTTP ${res.status})`);
  process.exit(1);
}

const { authHash } = await deriveMasterKeys(password, salt);
const cognitoPassword = toCognitoPassword(authHash);

console.log(`
# ---- paste into CloudShell ----
aws cognito-idp admin-create-user --user-pool-id ${poolId} --username ${username} \\
  --user-attributes Name=email,Value=${email} Name=email_verified,Value=true Name=name,Value=${username} \\
  --message-action SUPPRESS >/dev/null && echo "user created"
aws cognito-idp admin-set-user-password --user-pool-id ${poolId} --username ${username} \\
  --password '${cognitoPassword}' --permanent && echo "password set"
aws cognito-idp admin-add-user-to-group --user-pool-id ${poolId} --username ${username} --group-name admin && echo "added to admin"
`);

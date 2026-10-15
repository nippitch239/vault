/**
 * Amazon Cognito adapter (AWS Amplify JS v6, aws-amplify/auth).
 *
 * The password given to Cognito is the Authentication Key derived from the master
 * password (see shared/crypto.js toCognitoPassword); the master password itself never
 * leaves the browser. Tokens are kept in sessionStorage, not localStorage.
 */

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { sessionStorage as amplifySessionStorage } from 'aws-amplify/utils';
import {
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendSignUpCode,
  signIn as amplifySignIn,
  confirmSignIn as amplifyConfirmSignIn,
  signOut as amplifySignOut,
  fetchAuthSession,
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
  updatePassword,
} from 'aws-amplify/auth';
import { config } from '../../config.js';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!config.cognito.userPoolId || !config.cognito.userPoolClientId) {
    throw new Error('Cognito is not configured: set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID');
  }
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.cognito.userPoolId,
        userPoolClientId: config.cognito.userPoolClientId,
        loginWith: { username: true, email: true },
      },
    },
  });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(amplifySessionStorage);
  configured = true;
}

function mapNextStep(nextStep) {
  switch (nextStep?.signInStep) {
    case 'DONE':
      return { status: 'DONE' };
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
      return { status: 'TOTP_REQUIRED' };
    case 'CONFIRM_SIGN_UP':
      return { status: 'CONFIRM_SIGN_UP' };
    case 'RESET_PASSWORD':
      return { status: 'RESET_PASSWORD' };
    default:
      return { status: 'UNSUPPORTED', step: nextStep?.signInStep };
  }
}

export const cognitoAuth = {
  mode: 'cognito',

  async signUp({ username, email, password, name }) {
    ensureConfigured();
    const res = await amplifySignUp({
      username,
      password,
      options: { userAttributes: { email, name } },
    });
    return { userSub: res.userId, needsConfirmation: res.nextStep?.signUpStep === 'CONFIRM_SIGN_UP' };
  },

  async confirmSignUp({ username, code }) {
    ensureConfigured();
    await amplifyConfirmSignUp({ username, confirmationCode: code });
  },

  async resendSignUpCode({ username }) {
    ensureConfigured();
    await amplifyResendSignUpCode({ username });
  },

  async signIn({ username, password }) {
    ensureConfigured();
    // A stale session would make signIn throw UserAlreadyAuthenticatedException.
    await amplifySignOut().catch(() => {});
    const res = await amplifySignIn({ username, password });
    return mapNextStep(res.nextStep);
  },

  async confirmTotp({ code }) {
    ensureConfigured();
    const res = await amplifyConfirmSignIn({ challengeResponse: code });
    return mapNextStep(res.nextStep);
  },

  async getIdToken() {
    ensureConfigured();
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() || null;
  },

  async signOut() {
    ensureConfigured();
    await amplifySignOut();
  },

  async changePassword({ oldPassword, newPassword }) {
    ensureConfigured();
    await updatePassword({ oldPassword, newPassword });
  },

  async setupTotp({ accountName }) {
    ensureConfigured();
    const details = await setUpTOTP();
    return {
      sharedSecret: details.sharedSecret,
      otpauthUrl: details.getSetupUri('SecureVault', accountName).toString(),
    };
  },

  async verifyTotp({ code }) {
    ensureConfigured();
    await verifyTOTPSetup({ code });
    await updateMFAPreference({ totp: 'PREFERRED' });
  },
};

export default cognitoAuth;

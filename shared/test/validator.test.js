import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRegistration,
  validateLogin,
  validateMfaCode,
  validateVaultItem,
  validateEncryptedPayload,
  validateShareRequest,
  validatePasswordReset,
  getErrorMessage,
  ERROR_MESSAGES,
  isValidUsername,
  isValidEmail,
  isValidPassword,
  isValidMfaCode,
} from '../validator.js';

test('Regex Helper Validators', () => {
  // Username
  assert.equal(isValidUsername('alice'), true);
  assert.equal(isValidUsername('bob_123'), true);
  assert.equal(isValidUsername('john-doe'), true);
  assert.equal(isValidUsername('ab'), false); // Too short (< 3)
  assert.equal(isValidUsername('a'.repeat(31)), false); // Too long (> 30)
  assert.equal(isValidUsername('alice@work'), false); // Disallowed char

  // Email
  assert.equal(isValidEmail('alice@example.com'), true);
  assert.equal(isValidEmail('bob.smith+vault@domain.co.th'), true);
  assert.equal(isValidEmail('invalid-email'), false);
  assert.equal(isValidEmail('@domain.com'), false);
  assert.equal(isValidEmail('user@'), false);

  // Password length
  assert.equal(isValidPassword('short'), false); // < 8
  assert.equal(isValidPassword('12345678'), true); // 8
  assert.equal(isValidPassword('a'.repeat(128)), true); // 128
  assert.equal(isValidPassword('a'.repeat(129)), false); // > 128

  // MFA Code
  assert.equal(isValidMfaCode('123456'), true);
  assert.equal(isValidMfaCode('000000'), true);
  assert.equal(isValidMfaCode('12345'), false); // 5 digits
  assert.equal(isValidMfaCode('1234567'), false); // 7 digits
  assert.equal(isValidMfaCode('12345a'), false); // Non-digit
});

test('UC-1 Registration Validation: Success & Edge Cases', () => {
  // 1. Valid registration data
  const valid = validateRegistration({
    username: 'alice_dev',
    email: 'alice@example.com',
    fullName: 'Alice Walker',
    password: 'MasterPassword123!',
    confirmPassword: 'MasterPassword123!',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);

  // 2. Missing required fields
  const missing = validateRegistration({});
  assert.equal(missing.valid, false);
  assert.equal(missing.errors[0].code, 'REQUIRED_FIELDS');

  // 3. Password mismatch
  const mismatch = validateRegistration({
    username: 'alice_dev',
    email: 'alice@example.com',
    fullName: 'Alice',
    password: 'Password123!',
    confirmPassword: 'DifferentPassword456!',
  });
  assert.equal(mismatch.valid, false);
  const mismatchErr = mismatch.errors.find((e) => e.field === 'confirmPassword');
  assert.ok(mismatchErr);
  assert.equal(mismatchErr.code, 'PASSWORD_MISMATCH');
  assert.equal(mismatchErr.message, 'กรุณากรอกรหัสผ่านและยืนยันรหัสผ่านให้ตรงกัน');

  // 4. Password too short (< 8 chars)
  const tooShort = validateRegistration({
    username: 'alice_dev',
    email: 'alice@example.com',
    password: 'short',
    confirmPassword: 'short',
  });
  assert.equal(tooShort.valid, false);
  const shortErr = tooShort.errors.find((e) => e.field === 'password');
  assert.ok(shortErr);
  assert.equal(shortErr.code, 'PASSWORD_TOO_SHORT');
});

test('UC-2 Login Validation', () => {
  const valid = validateLogin({ identifier: 'alice_dev', password: 'secretPassword123!' });
  assert.equal(valid.valid, true);

  const missing = validateLogin({ identifier: 'alice_dev' });
  assert.equal(missing.valid, false);
  assert.equal(missing.errors[0].code, 'REQUIRED_FIELDS');
});

test('UC-3 MFA Code Validation', () => {
  const valid = validateMfaCode('654321');
  assert.equal(valid.valid, true);

  const invalid = validateMfaCode('abc123');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors[0].code, 'INVALID_MFA_CODE');
});

test('UC-4 & UC-5 Vault Item & Encrypted Payload Validation', () => {
  const validPayload = {
    ciphertext: 'k7aP92LmQx0vC4==',
    iv: '3d9Fa12B890c==',
    authTag: '99bE810aBcDeF012==',
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
  };

  // Valid item
  const validItem = validateVaultItem({
    title: 'AWS Root Account',
    category: 'LOGIN',
    encryptedPayload: validPayload,
  });
  assert.equal(validItem.valid, true);

  // Missing title
  const noTitle = validateVaultItem({
    title: '',
    category: 'LOGIN',
    encryptedPayload: validPayload,
  });
  assert.equal(noTitle.valid, false);
  assert.equal(noTitle.errors[0].code, 'REQUIRED_ITEM_FIELDS');

  // Invalid category
  const badCategory = validateVaultItem({
    title: 'AWS',
    category: 'INVALID_CAT_TYPE',
    encryptedPayload: validPayload,
  });
  assert.equal(badCategory.valid, false);
  assert.equal(badCategory.errors[0].code, 'INVALID_CATEGORY');

  // Corrupted payload
  const badPayload = validateEncryptedPayload({
    ciphertext: '',
    iv: '3d9Fa12B890c==',
    authTag: '99bE810aBcDeF012==',
  });
  assert.equal(badPayload.valid, false);
  assert.equal(badPayload.errors[0].code, 'INVALID_PAYLOAD');
});

test('UC-10 Password Sharing Validation', () => {
  const currentUserId = 'u-1234';
  const recipientUserId = 'u-5678';

  // Valid share
  const validShare = validateShareRequest(
    { recipientEmail: 'bob@example.com', permission: 'READ' },
    currentUserId,
    recipientUserId
  );
  assert.equal(validShare.valid, true);

  // Self-share attempt
  const selfShare = validateShareRequest(
    { recipientEmail: 'alice@example.com', permission: 'READ' },
    currentUserId,
    currentUserId // Same user ID
  );
  assert.equal(selfShare.valid, false);
  assert.equal(selfShare.errors[0].code, 'CANNOT_SHARE_WITH_SELF');
  assert.equal(selfShare.errors[0].message, 'ไม่สามารถแชร์ให้ตนเองได้');

  // Invalid permission
  const badPerm = validateShareRequest(
    { recipientEmail: 'bob@example.com', permission: 'ADMIN_SUPERUSER' },
    currentUserId,
    recipientUserId
  );
  assert.equal(badPerm.valid, false);
  assert.equal(badPerm.errors[0].code, 'INVALID_PERMISSION_LEVEL');
});

test('UC-7 Password Reset Validation', () => {
  const valid = validatePasswordReset({
    email: 'user@example.com',
    otp: '987123',
    newPassword: 'BrandNewPassword123!',
    confirmPassword: 'BrandNewPassword123!',
  });
  assert.equal(valid.valid, true);

  const invalidOtp = validatePasswordReset({
    email: 'user@example.com',
    otp: '12', // Too short
    newPassword: 'BrandNewPassword123!',
    confirmPassword: 'BrandNewPassword123!',
  });
  assert.equal(invalidOtp.valid, false);
  assert.equal(invalidOtp.errors[0].code, 'INVALID_OR_EXPIRED_OTP');
});

test('Bilingual Error Messages Localization (Thai & English)', () => {
  // Test key messages in both languages
  const th1 = getErrorMessage('INVALID_CREDENTIALS', 'th');
  assert.equal(th1.message, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
  assert.equal(th1.status, 401);

  const en1 = getErrorMessage('INVALID_CREDENTIALS', 'en');
  assert.equal(en1.message, 'Invalid username or password');
  assert.equal(en1.status, 401);

  const th2 = getErrorMessage('CONCURRENT_CONFLICT', 'th');
  assert.equal(th2.message, 'รายการนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณารีเฟรช');
  assert.equal(th2.status, 409);

  const en2 = getErrorMessage('CONCURRENT_CONFLICT', 'en');
  assert.ok(en2.message.includes('Concurrent edit conflict'));
  assert.equal(en2.status, 409);

  const th3 = getErrorMessage('PERMISSION_DENIED_DELETE', 'th');
  assert.equal(th3.message, 'คุณไม่มีสิทธิ์ในการลบรายการนี้');
  assert.equal(th3.status, 403);
});

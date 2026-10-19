/**
 * Secure Vault Cloud — Input Validation Rules & Bilingual Error Messages
 *
 * Implements authoritative validation rules and bilingual (Thai/English) error messages
 * matching UC-1 through UC-13 specifications.
 *
 * Ponytail minimalism: Pure native functions, zero regex/schema dependencies.
 */

// ============================================================================
// Standard Validation RegEx Patterns
// ============================================================================

export const PATTERNS = {
  // Username: 3-30 alphanumeric characters, underscores, hyphens
  USERNAME: /^[a-zA-Z0-9_-]{3,30}$/,
  // Standard RFC 5322 simplified email
  EMAIL: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
  // UUIDv4 format
  UUID: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  // MFA 6-digit numeric OTP
  MFA_CODE: /^\d{6}$/,
  // 64-char Hexadecimal (HMAC-SHA256 Auth Hash)
  HEX_64: /^[0-9a-fA-F]{64}$/,
  // Base64 string
  BASE64: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
};

// ============================================================================
// Bilingual Error Messages Dictionary (UC-1 through UC-13)
// ============================================================================

export const ERROR_MESSAGES = {
  // UC-1: Registration
  REQUIRED_FIELDS: {
    code: 'REQUIRED_FIELDS',
    status: 400,
    th: 'กรุณากรอกข้อมูลให้ถูกต้องครบถ้วน',
    en: 'Please fill all required fields',
  },
  INVALID_USERNAME: {
    code: 'INVALID_USERNAME',
    status: 400,
    th: 'ชื่อผู้ใช้ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลขความยาว 3-30 ตัวอักษร',
    en: 'Username must be 3-30 alphanumeric characters',
  },
  INVALID_EMAIL: {
    code: 'INVALID_EMAIL',
    status: 400,
    th: 'รูปแบบอีเมลไม่ถูกต้อง',
    en: 'Invalid email address format',
  },
  PASSWORD_TOO_SHORT: {
    code: 'PASSWORD_TOO_SHORT',
    status: 400,
    th: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร',
    en: 'Password must be at least 8 characters long',
  },
  PASSWORD_MISMATCH: {
    code: 'PASSWORD_MISMATCH',
    status: 400,
    th: 'กรุณากรอกรหัสผ่านและยืนยันรหัสผ่านให้ตรงกัน',
    en: 'Passwords do not match',
  },
  USERNAME_EXISTS: {
    code: 'USERNAME_EXISTS',
    status: 409,
    th: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาเปลี่ยนชื่อผู้ใช้',
    en: 'Username already taken',
  },
  EMAIL_EXISTS: {
    code: 'EMAIL_EXISTS',
    status: 409,
    th: 'อีเมลนี้ถูกใช้งานแล้ว กรุณาเปลี่ยนอีเมล',
    en: 'Email already in use',
  },
  INVALID_AUTH_HASH: {
    code: 'INVALID_AUTH_HASH',
    status: 400,
    th: 'รหัสแฮชสำหรับการยืนยันตัวตนไม่ถูกต้อง',
    en: 'Invalid client authentication hash',
  },
  INVALID_SALT: {
    code: 'INVALID_SALT',
    status: 400,
    th: 'ค่า Salt ไม่ถูกต้อง',
    en: 'Invalid cryptographic salt',
  },

  // UC-2: Login
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    status: 401,
    th: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    en: 'Invalid username or password',
  },
  ACCOUNT_LOCKED: {
    code: 'ACCOUNT_LOCKED',
    status: 423,
    th: 'บัญชีถูกระงับชั่วคราวเนื่องจากพยายามเข้าสู่ระบบผิดหลายครั้ง',
    en: 'Account temporarily locked due to multiple failed login attempts',
  },

  // UC-3: MFA
  INVALID_MFA_CODE: {
    code: 'INVALID_MFA_CODE',
    status: 401,
    th: 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    en: 'Invalid verification code, please try again',
  },
  MFA_SETUP_PENDING: {
    code: 'MFA_SETUP_PENDING',
    status: 400,
    th: 'การตั้งค่า MFA ยังไม่เสร็จสมบูรณ์',
    en: 'MFA setup pending verification',
  },

  // UC-4 & UC-5: Vault Items CRUD
  REQUIRED_ITEM_FIELDS: {
    code: 'REQUIRED_ITEM_FIELDS',
    status: 400,
    th: 'กรุณากรอกข้อมูลให้ครบถ้วน',
    en: 'Please fill required item fields',
  },
  INVALID_PAYLOAD: {
    code: 'INVALID_PAYLOAD',
    status: 400,
    th: 'ข้อมูลเข้ารหัสไม่ถูกต้องตามรูปแบบ',
    en: 'Invalid encrypted payload format',
  },
  INVALID_CATEGORY: {
    code: 'INVALID_CATEGORY',
    status: 400,
    th: 'หมวดหมู่รายการไม่ถูกต้อง',
    en: 'Invalid item category',
  },
  CONCURRENT_CONFLICT: {
    code: 'CONCURRENT_CONFLICT',
    status: 409,
    th: 'รายการนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณารีเฟรช',
    en: 'Concurrent edit conflict. Please refresh to view latest version',
  },
  ITEM_NOT_FOUND: {
    code: 'ITEM_NOT_FOUND',
    status: 404,
    th: 'ไม่พบรายการรหัสผ่านที่ต้องการ',
    en: 'Item not found',
  },

  // UC-6: Delete Item
  PERMISSION_DENIED_DELETE: {
    code: 'PERMISSION_DENIED_DELETE',
    status: 403,
    th: 'คุณไม่มีสิทธิ์ในการลบรายการนี้',
    en: 'Permission denied to delete this item',
  },

  // UC-7: Password Reset
  EMAIL_NOT_FOUND: {
    code: 'EMAIL_NOT_FOUND',
    status: 404,
    th: 'ไม่พบอีเมลนี้ในระบบ',
    en: 'Email not found in system',
  },
  INVALID_OR_EXPIRED_OTP: {
    code: 'INVALID_OR_EXPIRED_OTP',
    status: 400,
    th: 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ',
    en: 'Invalid or expired verification code',
  },

  // UC-8: Security Notification
  ABNORMAL_LOGIN: {
    code: 'ABNORMAL_LOGIN',
    status: 200,
    th: 'ตรวจพบความพยายามเข้าสู่ระบบผิดปกติ',
    en: 'Abnormal login attempt detected',
  },

  // UC-9 & UC-13: Admin Controls & Monitoring
  FORBIDDEN_ADMIN_ONLY: {
    code: 'FORBIDDEN_ADMIN_ONLY',
    status: 403,
    th: 'สิทธิ์การเข้าถึงถูกปฏิเสธสำหรับผู้ใช้ทั่วไป',
    en: 'Admin privilege required',
  },
  MONITORING_UNAVAILABLE: {
    code: 'MONITORING_UNAVAILABLE',
    status: 502,
    th: 'ไม่สามารถโหลดข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    en: 'Monitoring data temporarily unavailable',
  },

  // UC-10: Sharing
  RECIPIENT_NOT_FOUND: {
    code: 'RECIPIENT_NOT_FOUND',
    status: 404,
    th: 'ไม่พบบัญชีผู้ใช้นี้ในระบบ',
    en: 'Recipient user not found',
  },
  CANNOT_SHARE_WITH_SELF: {
    code: 'CANNOT_SHARE_WITH_SELF',
    status: 400,
    th: 'ไม่สามารถแชร์ให้ตนเองได้',
    en: 'Cannot share with self',
  },
  ALREADY_SHARED: {
    code: 'ALREADY_SHARED',
    status: 409,
    th: 'รายการนี้ได้รับการแชร์ให้กับผู้ใช้นี้แล้ว',
    en: 'Item is already shared with this user',
  },
  INVALID_PERMISSION_LEVEL: {
    code: 'INVALID_PERMISSION_LEVEL',
    status: 400,
    th: 'ระดับสิทธิ์การแชร์ไม่ถูกต้อง (ต้องเป็น READ หรือ WRITE)',
    en: 'Invalid permission level (must be READ or WRITE)',
  },

  // UC-11: Version History
  NO_HISTORY_AVAILABLE: {
    code: 'NO_HISTORY_AVAILABLE',
    status: 200,
    th: 'ยังไม่มีประวัติการเปลี่ยนแปลงของรายการนี้',
    en: 'No revision history available',
  },

  // UC-12: Activity Log
  NO_ACTIVITY_LOGS: {
    code: 'NO_ACTIVITY_LOGS',
    status: 200,
    th: 'ไม่มีข้อมูลกิจกรรมของบัญชีนี้',
    en: 'No activity records found',
  },
};

/**
 * Returns localized error message object for a given code.
 *
 * @param {string} code - Error message code
 * @param {'th'|'en'} [lang='th'] - Language
 * @returns {{ code: string, status: number, message: string }}
 */
export function getErrorMessage(code, lang = 'th') {
  const item = ERROR_MESSAGES[code] || {
    code: code || 'UNKNOWN_ERROR',
    status: 400,
    th: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
    en: 'An error occurred, please try again',
  };
  return {
    code: item.code,
    status: item.status,
    message: lang === 'en' ? item.en : item.th,
  };
}

// ============================================================================
// Granular Field Validators
// ============================================================================

export function isValidUsername(username) {
  return typeof username === 'string' && PATTERNS.USERNAME.test(username.trim());
}

export function isValidEmail(email) {
  return typeof email === 'string' && PATTERNS.EMAIL.test(email.trim().toLowerCase());
}

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

export function isValidMfaCode(code) {
  return typeof code === 'string' && PATTERNS.MFA_CODE.test(code.trim());
}

export function isValidUUID(id) {
  return typeof id === 'string' && PATTERNS.UUID.test(id.trim());
}

export function isValidAuthHash(hash) {
  return typeof hash === 'string' && PATTERNS.HEX_64.test(hash.trim());
}

// ============================================================================
// Workflow Validation Functions
// ============================================================================

/**
 * Validates UC-1 User Registration inputs
 *
 * @param {object} data
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateRegistration(data = {}, lang = 'th') {
  const errors = [];

  const { username, email, fullName, password, confirmPassword, authHash, authSalt } = data;

  if (!username || !email || (!password && !authHash)) {
    errors.push({ field: 'general', ...getErrorMessage('REQUIRED_FIELDS', lang) });
    return { valid: false, errors };
  }

  if (!isValidUsername(username)) {
    errors.push({ field: 'username', ...getErrorMessage('INVALID_USERNAME', lang) });
  }

  if (!isValidEmail(email)) {
    errors.push({ field: 'email', ...getErrorMessage('INVALID_EMAIL', lang) });
  }

  if (fullName !== undefined && (typeof fullName !== 'string' || fullName.trim().length === 0)) {
    errors.push({ field: 'fullName', ...getErrorMessage('REQUIRED_FIELDS', lang) });
  }

  // Password validation (if provided directly before client derivation)
  if (password !== undefined) {
    if (!isValidPassword(password)) {
      errors.push({ field: 'password', ...getErrorMessage('PASSWORD_TOO_SHORT', lang) });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      errors.push({ field: 'confirmPassword', ...getErrorMessage('PASSWORD_MISMATCH', lang) });
    }
  }

  // Auth Hash validation (if already derived)
  if (authHash !== undefined && !isValidAuthHash(authHash)) {
    errors.push({ field: 'authHash', ...getErrorMessage('INVALID_AUTH_HASH', lang) });
  }

  if (authSalt !== undefined && (typeof authSalt !== 'string' || authSalt.length < 16)) {
    errors.push({ field: 'authSalt', ...getErrorMessage('INVALID_SALT', lang) });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates UC-2 User Login inputs
 *
 * @param {object} data
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateLogin(data = {}, lang = 'th') {
  const errors = [];
  const identifier = data.username || data.email || data.identifier;
  const credential = data.password || data.authHash || data.auth_hash;

  if (!identifier || typeof identifier !== 'string' || identifier.trim().length === 0) {
    errors.push({ field: 'identifier', ...getErrorMessage('REQUIRED_FIELDS', lang) });
  }

  if (!credential || typeof credential !== 'string' || credential.trim().length === 0) {
    errors.push({ field: 'credential', ...getErrorMessage('REQUIRED_FIELDS', lang) });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates UC-3 MFA verification code
 *
 * @param {string|object} data - 6-digit code or object containing code
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateMfaCode(data, lang = 'th') {
  const code = typeof data === 'object' ? data.code || data.token : data;
  const errors = [];

  if (!code || !isValidMfaCode(code)) {
    errors.push({ field: 'code', ...getErrorMessage('INVALID_MFA_CODE', lang) });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates an AES-256-GCM Encrypted Payload
 *
 * @param {object} payload
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateEncryptedPayload(payload, lang = 'th') {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    errors.push({ field: 'payload', ...getErrorMessage('INVALID_PAYLOAD', lang) });
    return { valid: false, errors };
  }

  const ciphertext = payload.ciphertext;
  const iv = payload.iv;
  const authTag = payload.authTag || payload.auth_tag;
  const algorithm = payload.algorithm;

  if (!ciphertext || typeof ciphertext !== 'string' || ciphertext.length === 0) {
    errors.push({ field: 'ciphertext', ...getErrorMessage('INVALID_PAYLOAD', lang) });
  }

  if (!iv || typeof iv !== 'string' || iv.length === 0) {
    errors.push({ field: 'iv', ...getErrorMessage('INVALID_PAYLOAD', lang) });
  }

  if (!authTag || typeof authTag !== 'string' || authTag.length === 0) {
    errors.push({ field: 'authTag', ...getErrorMessage('INVALID_PAYLOAD', lang) });
  }

  if (algorithm && algorithm !== 'AES-256-GCM') {
    errors.push({ field: 'algorithm', ...getErrorMessage('INVALID_PAYLOAD', lang) });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates UC-4 & UC-5 Vault Item creation and update
 *
 * @param {object} data
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateVaultItem(data = {}, lang = 'th') {
  const errors = [];
  const ALLOWED_CATEGORIES = ['LOGIN', 'CARD', 'SECURE_NOTE', 'IDENTITY', 'SERVER'];

  // 1. Title validation
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push({ field: 'title', ...getErrorMessage('REQUIRED_ITEM_FIELDS', lang) });
  } else if (data.title.length > 150) {
    errors.push({ field: 'title', ...getErrorMessage('REQUIRED_ITEM_FIELDS', lang) });
  }

  // 2. Category validation
  if (data.category) {
    const cat = data.category.toString().toUpperCase();
    if (!ALLOWED_CATEGORIES.includes(cat)) {
      errors.push({ field: 'category', ...getErrorMessage('INVALID_CATEGORY', lang) });
    }
  }

  // 3. Encrypted Payload validation
  const payload = data.encryptedData || data.encryptedPayload || data.encrypted_data;
  if (!payload) {
    errors.push({ field: 'encryptedPayload', ...getErrorMessage('REQUIRED_ITEM_FIELDS', lang) });
  } else {
    const payloadRes = validateEncryptedPayload(payload, lang);
    if (!payloadRes.valid) {
      errors.push(...payloadRes.errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates UC-10 Password Sharing request
 *
 * @param {object} data - { recipientId, recipientEmail, permission }
 * @param {string} currentUserId - Owner user ID
 * @param {string} [recipientUserId] - Resolved recipient user ID
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateShareRequest(data = {}, currentUserId, recipientUserId, lang = 'th') {
  const errors = [];
  const ALLOWED_PERMISSIONS = ['READ', 'WRITE', 'MODIFY'];

  const recipientIdentifier = data.recipientId || data.recipientEmail || data.recipientUsername || recipientUserId;
  if (!recipientIdentifier) {
    errors.push({ field: 'recipient', ...getErrorMessage('RECIPIENT_NOT_FOUND', lang) });
  }

  // Prevent self-sharing
  if (recipientUserId && currentUserId && recipientUserId === currentUserId) {
    errors.push({ field: 'recipient', ...getErrorMessage('CANNOT_SHARE_WITH_SELF', lang) });
  }

  // Permission validation
  const permission = (data.permission || data.permissionLevel || 'READ').toString().toUpperCase();
  if (!ALLOWED_PERMISSIONS.includes(permission)) {
    errors.push({ field: 'permission', ...getErrorMessage('INVALID_PERMISSION_LEVEL', lang) });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates UC-7 Password Reset confirmation inputs
 *
 * @param {object} data - { email, otp, newPassword, confirmPassword }
 * @param {'th'|'en'} [lang='th']
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validatePasswordReset(data = {}, lang = 'th') {
  const errors = [];

  if (!isValidEmail(data.email)) {
    errors.push({ field: 'email', ...getErrorMessage('INVALID_EMAIL', lang) });
  }

  if (!data.otp || !isValidMfaCode(data.otp)) {
    errors.push({ field: 'otp', ...getErrorMessage('INVALID_OR_EXPIRED_OTP', lang) });
  }

  if (data.newPassword !== undefined) {
    if (!isValidPassword(data.newPassword)) {
      errors.push({ field: 'newPassword', ...getErrorMessage('PASSWORD_TOO_SHORT', lang) });
    }
    if (data.confirmPassword !== undefined && data.newPassword !== data.confirmPassword) {
      errors.push({ field: 'confirmPassword', ...getErrorMessage('PASSWORD_MISMATCH', lang) });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

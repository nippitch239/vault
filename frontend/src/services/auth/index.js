/**
 * Auth adapter selection. Production (Amplify hosting) uses Amazon Cognito; local
 * development can use the backend's Cognito emulator (VITE_AUTH_MODE=local).
 *
 * The Cognito adapter is loaded lazily so the AWS Amplify library is not part of the
 * local-mode bundle path (and so Node-based tests never import it).
 */

import { config } from '../../config.js';
import { localAuth } from './local.js';

let adapterPromise = null;

export function getAuth() {
  if (!adapterPromise) {
    adapterPromise =
      config.authMode === 'cognito'
        ? import('./cognito.js').then((m) => m.cognitoAuth)
        : Promise.resolve(localAuth);
  }
  return adapterPromise;
}

/** Maps Cognito / emulator exception names to user-facing Thai messages. */
export function describeAuthError(err) {
  const byName = {
    NotAuthorizedException: 'ชื่อผู้ใช้หรือรหัสผ่านหลักไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    UserNotFoundException: 'ชื่อผู้ใช้หรือรหัสผ่านหลักไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    UserNotConfirmedException: 'บัญชียังไม่ได้ยืนยันอีเมล กรุณากรอกรหัสยืนยันที่ส่งไปทางอีเมล',
    UsernameExistsException: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาเปลี่ยนชื่อผู้ใช้',
    AliasExistsException: 'อีเมลนี้ถูกใช้งานแล้ว กรุณาเปลี่ยนอีเมล',
    CodeMismatchException: 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    ExpiredCodeException: 'รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่',
    EnableSoftwareTokenMFAException: 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    LimitExceededException: 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    TooManyRequestsException: 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    InvalidPasswordException: 'รหัสผ่านไม่ตรงตามนโยบายของระบบ',
  };
  if (err?.message === 'Password attempts exceeded') {
    return 'ใส่รหัสผ่านผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว กรุณารอแล้วลองใหม่';
  }
  return byName[err?.name] || err?.message || 'เกิดข้อผิดพลาดในการยืนยันตัวตน';
}

export default getAuth;

/** Thai nav labels — the single source for the top bar, mobile drawer and any page title. */
export const NAV_LABELS = {
  vault: 'รายการรหัสผ่าน',
  shared: 'แชร์กับฉัน',
  collections: 'คอลเลกชัน',
  groups: 'กลุ่ม',
  generator: 'สร้างรหัสผ่าน',
  activity: 'กิจกรรมของฉัน',
  audit: 'บันทึกการตรวจสอบ',
  monitoring: 'สถานะระบบ',
};

/** Tabs grouped under the "ความปลอดภัย" menu (audit / monitoring are admin-only). */
export const SECURITY_TABS = ['activity', 'audit', 'monitoring'];
export const ADMIN_ONLY_TABS = ['audit', 'monitoring'];

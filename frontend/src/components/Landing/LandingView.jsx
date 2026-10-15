import React from 'react';
import { Button, Card, cn } from '../ui/index.js';
import { PublicNav, Brand, LANDING_SECTIONS } from './PublicNav.jsx';

/* ------------------------------------------------------------------------------------------
 * Public landing page (signed-out). Every claim below matches what the product actually does —
 * see README.md (key hierarchy, AWS architecture). No testimonials, customer counts or pricing.
 * ---------------------------------------------------------------------------------------- */

function Icon({ children, className = 'size-5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const icons = {
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.6a3.25 3.25 0 0 1 0 5.8M17.5 14.4a5.5 5.5 0 0 1 3 5.1" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 3.5 5 6.2v5.3c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6.2Z" />
      <path d="m9 12 2.2 2.2L15.2 10" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.6-8.6M16.5 6.5l2.5 2.5M14 9l2 2" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4M12 7.5V12l3 2" />
    </>
  ),
  list: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  sparkle: <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8Z" />,
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
};

/** Small pill label shown above a section title. */
function Eyebrow({ icon, children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-sm font-ui text-secondary-foreground backdrop-blur-sm',
        className
      )}
    >
      <Icon className="size-4 text-primary-glow">{icon}</Icon>
      {children}
    </span>
  );
}

/** Centered section heading: eyebrow, title, muted subtitle. */
function SectionHeading({ id, eyebrow, icon, title, subtitle }) {
  return (
    <div className="mx-auto mb-10 flex max-w-2xl flex-col items-center gap-4 text-center sm:mb-14">
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <h2 id={id} className="text-3xl leading-tight tracking-tight sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {subtitle && <p className="text-base text-muted-foreground sm:text-lg">{subtitle}</p>}
    </div>
  );
}

/** Round glowing chip that holds an icon. */
function IconChip({ icon, className }) {
  return (
    <span
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-full border border-primary-glow/40 bg-primary-glow/15 text-primary-glow shadow-glow-sm',
        className
      )}
    >
      <Icon className="size-5">{icon}</Icon>
    </span>
  );
}

const FEATURES = [
  {
    icon: icons.lock,
    title: 'เข้ารหัสก่อนออกจากเครื่อง',
    text: 'ทุกรายการถูกเข้ารหัสบนเบราว์เซอร์ของคุณ เซิร์ฟเวอร์ได้รับเพียงข้อมูลที่อ่านไม่ออก',
  },
  {
    icon: icons.users,
    title: 'คอลเลกชันสำหรับทีม',
    text: 'แชร์รหัสผ่านเป็นกลุ่ม กำหนดสิทธิ์อ่านอย่างเดียว แก้ไขได้ หรือผู้ดูแล ให้ทั้งรายบุคคลและกลุ่ม',
  },
  {
    icon: icons.shieldCheck,
    title: 'ยืนยันตัวตนสองขั้นตอน',
    text: 'เปิดใช้รหัส 6 หลักจากแอปยืนยันตัวตน (TOTP) เพื่อกันคนที่รู้รหัสผ่านของคุณ',
  },
  {
    icon: icons.key,
    title: 'สร้างรหัสผ่านที่แข็งแรง',
    text: 'สุ่มรหัสผ่านตามความยาวและชนิดตัวอักษรที่ต้องการ พร้อมแสดงระดับความแข็งแรง',
  },
  {
    icon: icons.history,
    title: 'ประวัติเวอร์ชัน',
    text: 'ดูการเปลี่ยนแปลงย้อนหลังของแต่ละรายการ และกู้คืนเวอร์ชันก่อนหน้าได้',
  },
  {
    icon: icons.list,
    title: 'บันทึกการตรวจสอบ',
    text: 'ติดตามกิจกรรมของบัญชีคุณ และให้ผู้ดูแลระบบตรวจสอบเหตุการณ์สำคัญย้อนหลังได้',
  },
];

const STEPS = [
  {
    title: 'สมัครและตั้งรหัสผ่านหลัก',
    text: 'รหัสผ่านหลักใช้สร้างกุญแจเข้ารหัสบนเครื่องของคุณ และไม่ถูกส่งไปที่เซิร์ฟเวอร์',
  },
  {
    title: 'เพิ่มรายการ ระบบเข้ารหัสบนเครื่อง',
    text: 'เพิ่มรหัสผ่านหรือบันทึกปลอดภัย ระบบเข้ารหัสบนเครื่องก่อนส่งไปเก็บทุกครั้ง',
  },
  {
    title: 'แชร์ให้ทีมผ่านคอลเลกชัน',
    text: 'เพิ่มสมาชิกหรือกลุ่มเข้าคอลเลกชัน แต่ละคนได้รับกุญแจที่ห่อไว้เฉพาะตัว',
  },
];

const KEY_POINTS = [
  {
    title: 'รหัสผ่านหลักอยู่บนเครื่องคุณเท่านั้น',
    text: 'เบราว์เซอร์แปลงรหัสผ่านหลักเป็นกุญแจด้วย Argon2id ระบบไม่เคยส่งหรือเก็บรหัสผ่านหลักไว้ที่เซิร์ฟเวอร์',
  },
  {
    title: 'กุญแจคลังเข้ารหัสทุกรายการ',
    text: 'กุญแจจากรหัสผ่านหลักใช้ปลดล็อกกุญแจคลังแบบสุ่ม ซึ่งเข้ารหัสรายการของคุณด้วย AES-256-GCM',
  },
  {
    title: 'แชร์โดยไม่เปิดเผยกุญแจ',
    text: 'แต่ละคอลเลกชันมีกุญแจของตัวเอง ห่อด้วยกุญแจสาธารณะ (RSA-OAEP) ของสมาชิกแต่ละคน',
  },
  {
    title: 'เซิร์ฟเวอร์เก็บแค่ข้อมูลที่เข้ารหัสแล้ว',
    text: 'ฐานข้อมูลมีเพียงข้อมูลเข้ารหัส ผู้ให้บริการจึงอ่านรหัสผ่านของคุณไม่ได้',
  },
];

const AWS_STACK = [
  { name: 'AWS Amplify', role: 'โฮสต์หน้าเว็บแอปพลิเคชัน' },
  { name: 'Amazon Cognito', role: 'เข้าสู่ระบบและการยืนยันตัวตนสองขั้นตอน' },
  { name: 'API Gateway + AWS WAF', role: 'ประตูหน้า API ตรวจสิทธิ์และกรองคำขอที่ผิดปกติ' },
  { name: 'AWS Lambda', role: 'ประมวลผลคำขอในเครือข่ายส่วนตัว (private subnet)' },
  { name: 'Amazon RDS PostgreSQL Multi-AZ', role: 'เก็บข้อมูลที่เข้ารหัสแล้ว สำรองข้ามสองโซน' },
  { name: 'AWS KMS + Secrets Manager', role: 'จัดการกุญแจของระบบและข้อมูลลับของฐานข้อมูล' },
];

const FAQS = [
  {
    q: 'ลืมรหัสผ่านหลักได้ไหม?',
    a: 'ระบบไม่เก็บรหัสผ่านหลักของคุณ จึงกู้คืนให้ไม่ได้ คุณตั้งรหัสผ่านหลักใหม่ได้ผ่านอีเมล แต่ระบบจะสร้างคลังใหม่ และรายการเดิมจะถอดรหัสไม่ได้อีก ควรจดรหัสผ่านหลักเก็บไว้ในที่ปลอดภัย',
  },
  {
    q: 'เซิร์ฟเวอร์อ่านรหัสผ่านของฉันได้ไหม?',
    a: 'ไม่ได้ ทุกรายการถูกเข้ารหัสบนเบราว์เซอร์ก่อนส่ง และกุญแจถอดรหัสสร้างจากรหัสผ่านหลักที่ไม่เคยออกจากเครื่องของคุณ เซิร์ฟเวอร์เก็บได้เพียงข้อมูลที่เข้ารหัสแล้ว',
  },
  {
    q: 'แชร์รหัสผ่านให้ทีมอย่างไร?',
    a: 'สร้างคอลเลกชัน ย้ายรายการเข้าไป แล้วเพิ่มสมาชิกหรือกลุ่มพร้อมกำหนดสิทธิ์ อ่านอย่างเดียว แก้ไขได้ หรือผู้ดูแล ระบบห่อกุญแจของคอลเลกชันให้สมาชิกแต่ละคนโดยอัตโนมัติ',
  },
  {
    q: 'เปิดการยืนยันตัวตนสองขั้นตอน (2FA) อย่างไร?',
    a: 'หลังเข้าสู่ระบบ เปิดเมนูบัญชีแล้วเลือก "การยืนยันตัวตนสองขั้นตอน (2FA)" สแกนคิวอาร์โค้ดด้วยแอปยืนยันตัวตน เช่น Google Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน',
  },
  {
    q: 'ข้อมูลของฉันเก็บไว้ที่ไหน?',
    a: 'ข้อมูลที่เข้ารหัสแล้วเก็บในฐานข้อมูล Amazon RDS PostgreSQL แบบ Multi-AZ บน AWS ซึ่งทำงานในเครือข่ายส่วนตัว และเข้าถึงได้ผ่าน API ที่ต้องยืนยันตัวตนเท่านั้น',
  },
  {
    q: 'ถ้ามีคนรู้รหัสผ่านหลักของฉันจะเกิดอะไรขึ้น?',
    a: 'ผู้ที่รู้รหัสผ่านหลักจะเข้าถึงคลังของคุณได้ จึงควรเปิดการยืนยันตัวตนสองขั้นตอนไว้ เพื่อให้ต้องใช้รหัสจากแอปบนโทรศัพท์ของคุณด้วยทุกครั้งที่เข้าสู่ระบบ',
  },
];

const SECTION = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';

/**
 * Public landing page.
 * @param {() => void} [onSignIn] open the sign-in screen
 * @param {() => void} [onSignUp] open the sign-up screen
 * @param {() => void} [onHome]   brand click (defaults to scrolling to the top)
 */
export function LandingView({ onSignIn, onSignUp, onHome }) {
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-transparent text-foreground">
      <PublicNav current="landing" onHome={onHome || scrollTop} onSignIn={onSignIn} onSignUp={onSignUp} />

      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative isolate">
          <div
            className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]"
            aria-hidden="true"
          />
          <div className={cn(SECTION, 'flex flex-col items-center pb-20 pt-16 text-center sm:pb-28 sm:pt-24 lg:pt-28')}>
            <Eyebrow icon={icons.sparkle}>Zero-Knowledge · เข้ารหัสบนเครื่องของคุณ</Eyebrow>

            <h1
              id="hero-title"
              className="text-gradient mt-6 max-w-5xl text-4xl uppercase leading-[1.2] tracking-tight sm:text-6xl lg:text-7xl"
            >
              รหัสผ่านทั้งหมดของคุณ
              <br />
              ปลอดภัยในที่เดียว
            </h1>

            <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
              SecureVault เข้ารหัสรหัสผ่านและข้อมูลสำคัญบนเบราว์เซอร์ของคุณก่อนส่งขึ้นคลาวด์
              แชร์ให้ทีมได้อย่างปลอดภัย โดยไม่มีใครอ่านข้อมูลของคุณได้ แม้แต่เซิร์ฟเวอร์ของเรา
            </p>

            <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
              {onSignUp && (
                <Button size="lg" onClick={onSignUp} className="w-full sm:w-auto">
                  สมัครสมาชิกฟรี
                  <Icon>{icons.arrowRight}</Icon>
                </Button>
              )}
              {onSignIn && (
                <Button size="lg" variant="outline" onClick={onSignIn} className="w-full sm:w-auto">
                  เข้าสู่ระบบ
                </Button>
              )}
            </div>

            <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Icon className="size-4 text-primary-glow">{icons.shieldCheck}</Icon>
              <span>รหัสผ่านหลักไม่เคยออกจากเครื่องของคุณ</span>
              <span aria-hidden="true">·</span>
              <span>ทำงานบน AWS</span>
            </p>
          </div>
        </section>

        {/* Features */}
        <section aria-labelledby="features-title" id="features" className="scroll-mt-20 border-t border-border py-20 sm:py-28">
          <div className={SECTION}>
            <SectionHeading
              id="features-title"
              eyebrow="คุณสมบัติ"
              icon={icons.sparkle}
              title="ทุกอย่างที่ต้องใช้ดูแลรหัสผ่าน"
              subtitle="ใช้คนเดียวหรือใช้กับทีมก็ได้ ทุกฟีเจอร์ทำงานบนข้อมูลที่เข้ารหัสแล้ว"
            />
            <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <Card className="flex h-full flex-col gap-4 p-6 sm:p-7">
                    <IconChip icon={f.icon} />
                    <div className="grid gap-1.5">
                      <h3 className="text-lg tracking-tight">{f.title}</h3>
                      <p className="text-sm text-muted-foreground">{f.text}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-title" id="how-it-works" className="scroll-mt-20 border-t border-border py-20 sm:py-28">
          <div className={SECTION}>
            <SectionHeading
              id="how-title"
              eyebrow="เริ่มใช้งาน"
              icon={icons.arrowRight}
              title="เริ่มได้ในสามขั้นตอน"
              subtitle="ไม่ต้องติดตั้งโปรแกรม ใช้งานผ่านเบราว์เซอร์ได้ทันที"
            />
            <ol className="grid gap-4 md:grid-cols-3 md:gap-5">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Card className="flex h-full flex-col gap-4 p-6 sm:p-7">
                    <span
                      className="flex size-11 items-center justify-center rounded-full bg-gradient-to-b from-primary-glow to-primary text-lg font-strong text-primary-foreground shadow-glow-sm"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <div className="grid gap-1.5">
                      <h3 className="text-lg tracking-tight">
                        <span className="sr-only">ขั้นตอนที่ {i + 1}: </span>
                        {s.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">{s.text}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Security */}
        <section aria-labelledby="security-title" id="security" className="scroll-mt-20 border-t border-border py-20 sm:py-28">
          <div className={cn(SECTION, 'grid items-start gap-10 lg:grid-cols-2 lg:gap-14')}>
            <div className="flex flex-col items-start gap-5">
              <Eyebrow icon={icons.shieldCheck}>ความปลอดภัย</Eyebrow>
              <h2 id="security-title" className="text-3xl leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                ออกแบบให้แม้แต่เราก็อ่านข้อมูลของคุณไม่ได้
              </h2>
              <p className="text-base text-muted-foreground sm:text-lg">
                SecureVault ใช้หลัก Zero-Knowledge กุญแจทุกดอกสร้างและใช้งานบนเบราว์เซอร์ของคุณ
                สิ่งที่ส่งไปเก็บบนคลาวด์มีแต่ข้อมูลที่เข้ารหัสแล้ว
              </p>
              <ol className="mt-2 grid w-full gap-5">
                {KEY_POINTS.map((p, i) => (
                  <li key={p.title} className="flex gap-4">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary-glow/40 bg-primary-glow/15 text-sm font-ui text-primary-glow"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <div className="grid gap-1">
                      <h3 className="text-base tracking-tight">{p.title}</h3>
                      <p className="text-sm text-muted-foreground">{p.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <Card className="p-6 sm:p-8">
              <div className="mb-6 flex items-center gap-4">
                <IconChip icon={icons.server} />
                <div className="grid gap-0.5">
                  <h3 className="text-lg tracking-tight">สถาปัตยกรรมบน AWS</h3>
                  <p className="text-sm text-muted-foreground">บริการที่ใช้รันระบบ และหน้าที่ของแต่ละส่วน</p>
                </div>
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {AWS_STACK.map((c) => (
                  <li key={c.name} className="flex flex-col gap-0.5 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <span className="text-sm font-ui text-foreground">{c.name}</span>
                    <span className="text-sm text-muted-foreground sm:text-right">{c.role}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-caption text-muted-foreground">
                การเชื่อมต่อทั้งหมดผ่าน HTTPS และ API ทุกเส้นต้องผ่านการยืนยันตัวตนกับ Amazon Cognito
              </p>
            </Card>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-title" id="faq" className="scroll-mt-20 border-t border-border py-20 sm:py-28">
          <div className={cn(SECTION, 'max-w-3xl')}>
            <SectionHeading
              id="faq-title"
              eyebrow="คำถามที่พบบ่อย"
              icon={icons.question}
              title="คำถามที่พบบ่อย"
              subtitle="สิ่งที่ควรรู้ก่อนเริ่มใช้ SecureVault"
            />
            <div className="grid gap-3">
              {FAQS.map((f) => (
                <details
                  key={f.q}
                  className="group rounded-lg border border-border bg-card/80 card-glow backdrop-blur-sm open:border-primary-glow/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-4 text-base font-ui text-foreground sm:px-6 [&::-webkit-details-marker]:hidden">
                    <span>{f.q}</span>
                    <Icon className="size-5 shrink-0 text-muted-foreground transition-transform duration-base group-open:rotate-180">
                      {icons.chevron}
                    </Icon>
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-6">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="cta-title" className="border-t border-border py-20 sm:py-28">
          <div className={SECTION}>
            <Card className="relative isolate overflow-hidden border-primary-glow/40 px-6 py-12 text-center sm:px-12 sm:py-16">
              <div
                className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
                aria-hidden="true"
              />
              <div className="mx-auto flex max-w-2xl flex-col items-center gap-5">
                <IconChip icon={icons.lock} className="size-14" />
                <h2 id="cta-title" className="text-3xl leading-tight tracking-tight sm:text-4xl">
                  เริ่มเก็บรหัสผ่านอย่างปลอดภัยวันนี้
                </h2>
                <p className="text-base text-muted-foreground sm:text-lg">
                  สร้างบัญชีแล้วตั้งรหัสผ่านหลัก คลังรหัสผ่านที่เข้ารหัสของคุณพร้อมใช้งานทันที
                </p>
                <div className="mt-3 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
                  {onSignUp && (
                    <Button size="lg" onClick={onSignUp} className="w-full sm:w-auto">
                      สมัครสมาชิกฟรี
                    </Button>
                  )}
                  {onSignIn && (
                    <Button size="lg" variant="outline" onClick={onSignIn} className="w-full sm:w-auto">
                      มีบัญชีแล้ว? เข้าสู่ระบบ
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className={cn(SECTION, 'flex flex-col gap-8 py-10 sm:py-12 md:flex-row md:items-start md:justify-between')}>
          <div className="grid max-w-sm gap-3">
            <Brand />
            <p className="text-sm text-muted-foreground">
              ตัวจัดการรหัสผ่านแบบ Zero-Knowledge เข้ารหัสบนเครื่องของคุณ ทำงานบน AWS
            </p>
          </div>
          <nav aria-label="ลิงก์ส่วนท้าย">
            <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-ui">
              {LANDING_SECTIONS.map((s) => (
                <li key={s.href}>
                  <a href={s.href} className="text-muted-foreground transition-colors duration-fast hover:text-foreground">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="border-t border-border">
          <p className={cn(SECTION, 'py-6 text-caption text-muted-foreground')}>
            © {new Date().getFullYear()} SecureVault
          </p>
        </div>
      </footer>
    </div>
  );
}

export default LandingView;

import React from 'react';
import { Button, cn } from '../ui/index.js';

/** Our own brand mark: a round vault door with a dial ring and a keyhole. */
export function BrandMark({ className = 'size-8' }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="14.25" />
      <circle cx="16" cy="16" r="9.5" />
      <path d="M16 1.75v3M16 27.25v3M1.75 16h3M27.25 16h3" />
      <circle cx="16" cy="14.25" r="2.25" />
      <path d="M15.1 16.2 14.5 20.5h3l-.6-4.3" />
    </svg>
  );
}

/** Clickable logo + wordmark. Renders a button when `onClick` is given, otherwise plain text. */
export function Brand({ onClick, className }) {
  const content = (
    <>
      <BrandMark className="size-8 text-primary-glow" />
      <span className="text-lg font-strong tracking-tight text-foreground">SecureVault</span>
    </>
  );
  if (!onClick) {
    return <span className={cn('inline-flex items-center gap-2.5', className)}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="SecureVault หน้าแรก"
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full py-1 pr-2 transition-opacity duration-fast hover:opacity-90',
        className
      )}
    >
      {content}
    </button>
  );
}

export const LANDING_SECTIONS = [
  { href: '#features', label: 'คุณสมบัติ' },
  { href: '#security', label: 'ความปลอดภัย' },
  { href: '#faq', label: 'คำถามที่พบบ่อย' },
];

/**
 * Sticky top bar for the signed-out pages (landing + auth screens).
 * @param {() => void} [onHome]   brand click
 * @param {() => void} [onSignIn] "เข้าสู่ระบบ" button (hidden when omitted)
 * @param {() => void} [onSignUp] "สมัครสมาชิก" button (hidden when omitted)
 * @param {'landing'|'auth'} [current] in-page section links are rendered only for 'landing'
 */
export function PublicNav({ onHome, onSignIn, onSignUp, current }) {
  const showLinks = current === 'landing';
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:h-[4.5rem] sm:px-6 lg:px-8">
        <Brand onClick={onHome} className="shrink-0" />

        {showLinks && (
          <nav aria-label="ส่วนต่าง ๆ ของหน้า" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {LANDING_SECTIONS.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    className="rounded-full px-4 py-2 text-sm font-ui text-muted-foreground transition-colors duration-fast hover:text-foreground"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {(onSignIn || onSignUp) && (
          <div className="flex shrink-0 items-center gap-2">
            {onSignIn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSignIn}
                className="px-3 sm:h-10 sm:px-5 sm:text-sm"
              >
                เข้าสู่ระบบ
              </Button>
            )}
            {onSignUp && (
              <Button size="sm" onClick={onSignUp} className="px-4 sm:h-10 sm:px-5 sm:text-sm">
                สมัครสมาชิก
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default PublicNav;

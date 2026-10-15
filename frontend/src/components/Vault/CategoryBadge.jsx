import React from 'react';
import { Badge } from '../ui/Badge.jsx';
import { KeyIcon } from '../Common/Icons.jsx';

function NoteIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function CardIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

function IdentityIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
    </svg>
  );
}

function ServerIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  );
}

export function CategoryBadge({ category = 'login', className = '' }) {
  const norm = (category || 'login').toLowerCase();

  switch (norm) {
    case 'login':
      return (
        <Badge
          round
          variant="secondary"
          className={`gap-1 font-semibold text-[11px] uppercase tracking-wider ${className}`}
        >
          <KeyIcon className="w-3 h-3 text-emerald-400 shrink-0" />
          <span>Login</span>
        </Badge>
      );
    case 'secure_note':
    case 'note':
      return (
        <Badge
          round
          variant="outline"
          className={`gap-1 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground ${className}`}
        >
          <NoteIcon className="w-3 h-3 text-sky-400 shrink-0" />
          <span>Note</span>
        </Badge>
      );
    case 'card':
      return (
        <Badge
          round
          variant="warning"
          className={`gap-1 font-semibold text-[11px] uppercase tracking-wider ${className}`}
        >
          <CardIcon className="w-3 h-3 shrink-0" />
          <span>Card</span>
        </Badge>
      );
    case 'identity':
      return (
        <Badge
          round
          variant="info"
          className={`gap-1 font-semibold text-[11px] uppercase tracking-wider ${className}`}
        >
          <IdentityIcon className="w-3 h-3 shrink-0" />
          <span>Identity</span>
        </Badge>
      );
    case 'server':
      return (
        <Badge
          round
          variant="success"
          className={`gap-1 font-semibold text-[11px] uppercase tracking-wider ${className}`}
        >
          <ServerIcon className="w-3 h-3 shrink-0" />
          <span>Server</span>
        </Badge>
      );
    default:
      return (
        <Badge
          round
          variant="default"
          className={`gap-1 font-semibold text-[11px] uppercase tracking-wider ${className}`}
        >
          <KeyIcon className="w-3 h-3 shrink-0" />
          <span>{norm}</span>
        </Badge>
      );
  }
}

export default CategoryBadge;

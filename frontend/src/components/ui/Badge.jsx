import React from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export const badgeVariants = ({
  variant = 'default',
  round = false,
  className = '',
} = {}) => {
  const base =
    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-ui leading-5 transition-colors';

  const variants = {
    default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
    error: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'text-secondary-foreground border-border bg-transparent',
    success: 'border-transparent bg-success text-success-foreground',
    warning: 'border-transparent bg-warning text-warning-foreground',
    info: 'border-transparent bg-info text-info-foreground',
  };

  return cn(
    base,
    variants[variant] || variants.default,
    round && 'rounded-full',
    className
  );
};

export const Badge = React.forwardRef(
  ({ className, variant = 'default', round = false, ...props }, ref) => {
    return (
      <span ref={ref} className={badgeVariants({ variant, round, className })} {...props} />
    );
  }
);

Badge.displayName = 'Badge';

export default Badge;

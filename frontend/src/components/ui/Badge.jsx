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
    'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2';

  const variants = {
    default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
    error: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'text-foreground border-border',
    success: 'border-transparent bg-success text-success-foreground hover:bg-success/80',
    warning: 'border-transparent bg-warning text-warning-foreground hover:bg-warning/80',
    info: 'border-transparent bg-info text-info-foreground hover:bg-info/80',
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
      <div
        ref={ref}
        className={badgeVariants({ variant, round, className })}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export default Badge;

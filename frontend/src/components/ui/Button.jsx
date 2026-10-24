import React from 'react';

export function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = '',
} = {}) => {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-ui ring-offset-background transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

  const variants = {
    // Glowing violet pill for the main action; outlined violet pill for secondary CTAs.
    // Solid violet underneath so the button is never transparent if the gradient is missing.
    default: 'bg-primary bg-gradient-to-b from-primary-glow to-primary text-primary-foreground shadow-glow hover:brightness-110',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    outline: 'border border-primary-glow/50 bg-primary/10 text-foreground hover:bg-primary/25 hover:border-primary-glow/80',
    secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-accent hover:border-input',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    // ring = #b77cff on dark (7.3:1) / #6804ab on light (8.8:1); primary is too dark for text on black.
    link: 'text-ring underline-offset-4 hover:underline',
  };

  const sizes = {
    default: 'h-10 px-5 py-2',
    sm: 'h-9 px-4 text-xs',
    lg: 'h-12 px-8 text-base',
    icon: 'size-10',
    'icon-sm': 'size-8',
  };

  return cn(
    base,
    variants[variant] || variants.default,
    sizes[size] || sizes.default,
    className
  );
};

export const Button = React.forwardRef(
  ({ className, variant = 'default', size = 'default', type = 'button', disabled, loading = false, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={buttonVariants({ variant, size, className })}
        {...props}
      >
        {loading && (
          <svg className="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;

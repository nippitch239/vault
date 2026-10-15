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
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-ui ring-offset-background transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

  const variants = {
    // Brand indigo is reserved for the primary action (design/DESIGN.md §7).
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    outline: 'border border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
    secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-accent',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    link: 'text-primary underline-offset-4 hover:underline',
  };

  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 px-3 text-xs rounded-md',
    lg: 'h-11 px-8 rounded-md',
    icon: 'size-10 rounded-md',
    'icon-sm': 'size-8 rounded-md',
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

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          glow: 'hsl(var(--primary-glow) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        error: {
          DEFAULT: 'hsl(var(--error) / <alpha-value>)',
          foreground: 'hsl(var(--error-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
          primary: 'hsl(var(--sidebar-primary) / <alpha-value>)',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground) / <alpha-value>)',
          accent: 'hsl(var(--sidebar-accent) / <alpha-value>)',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground) / <alpha-value>)',
          border: 'hsl(var(--sidebar-border) / <alpha-value>)',
          ring: 'hsl(var(--sidebar-ring) / <alpha-value>)',
        },
        overlay: 'hsl(var(--overlay) / <alpha-value>)',
      },
      // Vault theme (design/TOKENS.md)
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontWeight: {
        ui: '400',
        strong: '500',
      },
      fontSize: {
        caption: ['0.8125rem', { lineHeight: '1.5' }],
      },
      boxShadow: {
        raised: '0 2px 4px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.05)',
        dialog:
          '0 8px 2px rgb(0 0 0 / 0), 0 5px 2px rgb(0 0 0 / 0.01), 0 3px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.07), 0 0 1px rgb(0 0 0 / 0.08), 0 24px 48px -12px rgb(0 0 0 / 0.5)',
        inset: 'inset 0 0 12px rgb(0 0 0 / 0.2)',
        glow: '0 0 0 1px hsl(var(--primary-glow) / 0.55), 0 8px 32px -6px hsl(var(--glow) / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.18)',
        'glow-sm': '0 0 0 1px hsl(var(--primary-glow) / 0.45), 0 4px 18px -6px hsl(var(--glow) / 0.55)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
      },
      // Pills for buttons/chips (rounded-full), 12px controls, 20px cards, 24px panels.
      borderRadius: {
        '2xl': '1.75rem',
        xl: '1.5rem',
        lg: 'var(--radius)',
        md: '0.75rem',
        sm: '0.5rem',
      },
      keyframes: {
        'content-show': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'content-hide': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.96)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--kb-accordion-content-height, 100%)' },
        },
        'accordion-up': {
          from: { height: 'var(--kb-accordion-content-height, 100%)' },
          to: { height: '0' },
        },
        'slide-in-from-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-to-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'slide-in-from-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-to-left': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-100%)' },
        },
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
      },
      animation: {
        'content-show': 'content-show 0.2s ease-out',
        'content-hide': 'content-hide 0.2s ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-from-right': 'slide-in-from-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-out-to-right': 'slide-out-to-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-from-left': 'slide-in-from-left 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-out-to-left': 'slide-out-to-left 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
      },
    },
  },
  plugins: [],
};

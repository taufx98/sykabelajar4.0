/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Semantic surface colors (theme-aware via CSS) ──
        surface: {
          DEFAULT: 'var(--surface)',       // body background
          card: 'var(--surface-card)',     // cards, panels
          elevated: 'var(--surface-elevated)', // elevated elements
          border: 'var(--surface-border)', // borders
        },
        // ── Semantic text colors ──
        fg: {
          DEFAULT: 'var(--fg)',           // primary text
          secondary: 'var(--fg-secondary)', // secondary text
          muted: 'var(--fg-muted)',       // muted text
        },
        // ── Accent (emerald green, theme-aware) ──
        accent: {
          DEFAULT: 'var(--accent)',
          light: 'var(--accent-light)',
          muted: 'var(--accent-muted)',
        },
        ink: {
          950: '#070b14',
          900: '#0b1220',
          850: '#0e1626',
          800: '#111a2e',
          750: '#15203a',
          700: '#1a2742',
          600: '#243152',
          500: '#334365',
          400: '#4b5a82',
        },
        moss: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        teal: {
          deep: '#0d4a47',
        },
        accent: {
          DEFAULT: '#10b981',
        },
        warn: {
          DEFAULT: '#f59e0b',
        },
        err: {
          DEFAULT: '#ef4444',
        },
        ok: {
          DEFAULT: '#10b981',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(16,185,129,0.25), 0 8px 30px rgba(16,185,129,0.12)',
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)',
        pop: '0 12px 40px rgba(0,0,0,0.55)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-down': { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pop-in': { '0%': { opacity: '0', transform: 'scale(0.8)' }, '60%': { opacity: '1', transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        glow: { '0%,100%': { boxShadow: '0 0 0 1px rgba(16,185,129,0.15), 0 0 24px rgba(16,185,129,0.1)' }, '50%': { boxShadow: '0 0 0 1px rgba(16,185,129,0.4), 0 0 36px rgba(16,185,129,0.25)' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        'slide-down': 'slide-down 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.16,1,0.3,1) both',
        'pop-in': 'pop-in 0.4s cubic-bezier(0.16,1,0.3,1) both',
        float: 'float 4s ease-in-out infinite',
        glow: 'glow 3s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
        marquee: 'marquee linear infinite',
      },
    },
  },
  plugins: [],
};

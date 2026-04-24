/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        pool: {
          50:  'rgb(var(--pool-50) / <alpha-value>)',
          100: 'rgb(var(--pool-100) / <alpha-value>)',
          200: 'rgb(var(--pool-200) / <alpha-value>)',
          300: 'rgb(var(--pool-300) / <alpha-value>)',
          400: 'rgb(var(--pool-400) / <alpha-value>)',
          500: 'rgb(var(--pool-500) / <alpha-value>)',
          600: 'rgb(var(--pool-600) / <alpha-value>)',
          700: 'rgb(var(--pool-700) / <alpha-value>)',
          800: 'rgb(var(--pool-800) / <alpha-value>)',
          900: 'rgb(var(--pool-900) / <alpha-value>)',
          950: 'rgb(var(--pool-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      spacing: {
        tap: '44px',
      },
      minHeight: {
        'tap': '44px',
      },
      minWidth: {
        'tap': '44px',
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        'card-hover': '0 4px 12px 0 rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.04)',
        'elevated': '0 8px 24px -4px rgba(0, 0, 0, 0.08), 0 4px 8px -4px rgba(0, 0, 0, 0.04)',
        'soft-lift': '0 10px 30px -10px rgba(0, 0, 0, 0.12)',
        'glow': '0 0 20px rgb(var(--pool-500) / 0.15)',
        'glow-lg': '0 0 40px rgb(var(--pool-500) / 0.2)',
        'nav': '0 -1px 12px 0 rgba(0, 0, 0, 0.06)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.04)',
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, rgb(var(--pool-500)) 0%, rgb(var(--pool-700)) 100%)',
        'gradient-brand-light': 'linear-gradient(135deg, rgb(var(--pool-100)) 0%, rgb(var(--pool-50)) 100%)',
        'gradient-brand-soft': 'linear-gradient(135deg, rgb(var(--pool-100)) 0%, rgb(var(--pool-50)) 100%)',
        'gradient-success': 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        'gradient-danger': 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        'gradient-warm': 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        'gradient-glass': 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)',
        'gradient-page': 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.18s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slideInRight 0.25s ease-out',
        'count-up': 'countUp 0.6s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        countUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

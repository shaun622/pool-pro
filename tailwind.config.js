/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        pool: {
          50: '#f0faff',
          100: '#e0f4fe',
          200: '#b9e8fe',
          300: '#7cd7fd',
          400: '#36c1fa',
          500: '#0CA5EB',
          600: '#0084C9',
          700: '#0069A3',
          800: '#045886',
          900: '#0A4A6F',
          950: '#062F4A',
        },
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
        'glow': '0 0 20px rgba(12, 165, 235, 0.15)',
        'glow-lg': '0 0 40px rgba(12, 165, 235, 0.2)',
        'nav': '0 -1px 12px 0 rgba(0, 0, 0, 0.06)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.04)',
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #0CA5EB 0%, #0069A3 100%)',
        'gradient-brand-light': 'linear-gradient(135deg, #e0f4fe 0%, #f0faff 100%)',
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
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'slide-in-right': 'slideInRight 0.25s ease-out',
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
      },
    },
  },
  plugins: [],
}

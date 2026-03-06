import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      colors: {
        megh: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        surface: {
          0: '#0a0a0f',
          50: '#111118',
          100: '#18181f',
          200: '#1f1f28',
          300: '#2a2a35',
          400: '#3a3a48',
          500: '#52525e',
          600: '#71717e',
          700: '#a1a1ae',
          800: '#d4d4de',
          900: '#f4f4f8',
        },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'spin-slow': 'spin 2s linear infinite',
        'fade-up': 'fade-up 0.5s ease-out both',
        'fade-up-delay-1': 'fade-up 0.5s ease-out 0.1s both',
        'fade-up-delay-2': 'fade-up 0.5s ease-out 0.2s both',
        'fade-up-delay-3': 'fade-up 0.5s ease-out 0.3s both',
        'scale-in': 'scale-in 0.3s ease-out both',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-up': {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(99,102,241,0.15)' },
          '50%': { boxShadow: '0 0 40px rgba(99,102,241,0.3)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        'glow-sm': '0 0 12px rgba(99,102,241,0.2)',
        'glow-md': '0 0 24px rgba(99,102,241,0.25)',
        'glow-lg': '0 0 48px rgba(99,102,241,0.3)',
        'elevated': '0 8px 32px rgba(0,0,0,0.4)',
        'card': '0 2px 8px rgba(0,0,0,0.2)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'shimmer': 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
      },
    },
  },
  plugins: [],
};

export default config;

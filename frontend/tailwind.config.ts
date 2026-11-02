import type { Config } from 'tailwindcss';

/**
 * Tokens are deliberately small: a marketplace page renders hundreds of product cards, and a
 * palette that fits in the browser's style cache keeps scroll smooth on the low-end Androids
 * that dominate Kampala and Nairobi.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Brand green reads as money and go-ahead in both markets.
        bemz: {
          50: '#f0faf3',
          100: '#dbf2e2',
          200: '#bae5c9',
          300: '#8bd2a9',
          400: '#57b784',
          500: '#2f9c66',
          600: '#1f8a4c',
          700: '#196e3f',
          800: '#175735',
          900: '#13482e',
          950: '#0a2a1a',
        },
        // Terracotta accent for prices, discounts and "act now" surfaces.
        clay: {
          50: '#fdf5f1',
          100: '#fbe8de',
          200: '#f6cfbd',
          300: '#efab8f',
          400: '#e67f57',
          500: '#d95d31',
          600: '#c14624',
          700: '#a03620',
          800: '#843021',
          900: '#6c2b20',
        },
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae2',
          300: '#b0bac9',
          400: '#8391a8',
          500: '#64738c',
          600: '#4f5c73',
          700: '#414b5d',
          800: '#38404f',
          900: '#323844',
          950: '#1f232c',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31, 35, 44, 0.06), 0 8px 24px -12px rgba(31, 35, 44, 0.16)',
        raised: '0 12px 40px -12px rgba(31, 35, 44, 0.32)',
      },
      borderRadius: {
        card: '14px',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 180ms ease-out',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        accent: {
          50: '#fefce8',
          100: '#fef9c3',
          500: '#eab308',
          600: '#fde047',
          700: '#ca8a04',
          900: '#713f12',
        },
        // Central Color System
        todo: {
          50: 'var(--color-todo-50)',
          100: 'var(--color-todo-100)',
          200: 'var(--color-todo-200)',
          400: 'var(--color-todo-400)',
          500: 'var(--color-todo-500)',
          600: 'var(--color-todo-600)',
          700: 'var(--color-todo-700)',
          900: 'var(--color-todo-900)',
        },
        owned: {
          50: 'var(--color-owned-50)',
          100: 'var(--color-owned-100)',
          200: 'var(--color-owned-200)',
          400: 'var(--color-owned-400)',
          500: 'var(--color-owned-500)',
          600: 'var(--color-owned-600)',
          700: 'var(--color-owned-700)',
          900: 'var(--color-owned-900)',
        },
        assigned: {
          50: 'var(--color-assigned-50)',
          100: 'var(--color-assigned-100)',
          200: 'var(--color-assigned-200)',
          400: 'var(--color-assigned-400)',
          500: 'var(--color-assigned-500)',
          600: 'var(--color-assigned-600)',
          700: 'var(--color-assigned-700)',
          900: 'var(--color-assigned-900)',
        },
        overdue: {
          50: 'var(--color-overdue-50)',
          100: 'var(--color-overdue-100)',
          200: 'var(--color-overdue-200)',
          400: 'var(--color-overdue-400)',
          500: 'var(--color-overdue-500)',
          600: 'var(--color-overdue-600)',
          700: 'var(--color-overdue-700)',
          900: 'var(--color-overdue-900)',
        },
        vendor: {
          50: 'var(--color-vendor-50)',
          100: 'var(--color-vendor-100)',
          200: 'var(--color-vendor-200)',
          400: 'var(--color-vendor-400)',
          500: 'var(--color-vendor-500)',
          600: 'var(--color-vendor-600)',
          700: 'var(--color-vendor-700)',
          900: 'var(--color-vendor-900)',
        },
        ticket: {
          50: 'var(--color-ticket-50)',
          100: 'var(--color-ticket-100)',
          200: 'var(--color-ticket-200)',
          400: 'var(--color-ticket-400)',
          500: 'var(--color-ticket-500)',
          600: 'var(--color-ticket-600)',
          700: 'var(--color-ticket-700)',
          900: 'var(--color-ticket-900)',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'var(--font-noto-gujarati)',
          'var(--font-noto-devanagari)',
          'var(--font-noto-tamil)',
          'var(--font-noto-telugu)',
          'var(--font-noto-bengali)',
          'var(--font-noto-kannada)',
          'var(--font-noto-malayalam)',
          'var(--font-noto-gurmukhi)',
          'sans-serif',
        ],
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' }
        }
      },
      animation: {
        shimmer: 'shimmer 2s infinite linear'
      }
    },
  },
  plugins: [],
};
export default config;

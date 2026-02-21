/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f172a',
          card: '#111827',
          elevated: '#1e293b',
        },
        accent: {
          DEFAULT: '#22d3ee',
          hover: '#06b6d4',
          muted: '#164e63',
        },
        border: {
          DEFAULT: '#1f2937',
          hover: '#374151',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

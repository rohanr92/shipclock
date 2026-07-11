/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        porcelain: '#F3F5F4',
        ink: '#14181A',
        muted: '#5C6670',
        line: '#E2E6E4',
        good: '#0E7A4E',
        warn: '#9A6B15',
        bad: '#C0362C',
      },
      fontFamily: {
        display: ['Archivo', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

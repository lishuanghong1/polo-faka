/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f8fa',
          100: '#eef0f4',
          200: '#dde1e9',
          300: '#c0c6d2',
          400: '#8e95a3',
          500: '#5d6473',
          600: '#3e4452',
          700: '#2a2f3a',
          800: '#1c2029',
          900: '#13161d',
          950: '#0b0c10',
        },
        brand: {
          50: '#eff8ff',
          100: '#deefff',
          200: '#b6e0ff',
          300: '#76c8ff',
          400: '#34acff',
          500: '#0d8eff',
          600: '#0070e0',
          700: '#0058b1',
          800: '#054b91',
          900: '#0a4078',
        },
      },
      fontFamily: {
        sans: [
          'PingFang SC',
          'Microsoft YaHei',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Consolas', 'Menlo', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};

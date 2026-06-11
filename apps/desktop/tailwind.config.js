/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 注意：为复用桌面端已有的深色类名，这里把 ink 调色板「反转」
        // ——数值越大颜色越浅。于是 text-ink-100 仍是主文字（深），
        // bg-ink-900 / 950 变成浅色面板/白底，整体呈现网站的白底风格。
        ink: {
          50: '#1c1917',
          100: '#1c1917',
          200: '#292524',
          300: '#44403c',
          400: '#57534e',
          500: '#78716c',
          600: '#a8a29e',
          700: '#e7e5e4',
          800: '#efedeb',
          900: '#f6f5f4',
          950: '#ffffff',
        },
        // 主色：墨绿，与网站一致
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
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

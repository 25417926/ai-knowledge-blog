import type { Config } from 'tailwindcss';

/**
 * 设计令牌走 CSS 变量（见 globals.css），dark 模式用 class 策略。
 * 变量存「空格分隔的 RGB 通道」，因此 bg-ink-panel/60 这类透明度修饰符照常可用。
 */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          bg: 'rgb(var(--ink-bg) / <alpha-value>)',
          panel: 'rgb(var(--ink-panel) / <alpha-value>)',
          line: 'rgb(var(--ink-line) / <alpha-value>)',
          dim: 'rgb(var(--ink-dim) / <alpha-value>)',
          text: 'rgb(var(--ink-text) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI Variable Text',
          'Segoe UI',
          'Noto Sans SC',
          'PingFang SC',
          'Microsoft YaHei UI',
          'Microsoft YaHei',
          'sans-serif',
        ],
        serif: [
          'Iowan Old Style',
          'Georgia',
          'Noto Serif SC',
          'Source Han Serif SC',
          'Songti SC',
          'STSong',
          'serif',
        ],
        mono: ['ui-monospace', 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent) / 0.25), 0 8px 30px -8px rgb(var(--accent) / 0.35)',
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      keyframes: {
        drift: {
          '0%': { transform: 'translate3d(0,0,0)', opacity: '0' },
          '10%': { opacity: 'var(--drift-peak, 0.7)' },
          '90%': { opacity: 'var(--drift-peak, 0.7)' },
          '100%': { transform: 'translate3d(var(--drift-x, 20px), -110vh, 0)', opacity: '0' },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.15' },
          '50%': { opacity: '0.9' },
        },
        aurora: {
          '0%, 100%': { transform: 'translate3d(-4%, -2%, 0) scale(1)' },
          '50%': { transform: 'translate3d(4%, 3%, 0) scale(1.12)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translate3d(0, 14px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        shine: {
          from: { transform: 'translateX(-120%)' },
          to: { transform: 'translateX(220%)' },
        },
        danmaku: {
          from: { transform: 'translate3d(0, 0, 0)' },
          to: { transform: 'translate3d(calc(-100vw - 100%), 0, 0)' },
        },
        'float-up': {
          '0%': { transform: 'translate3d(0, 0, 0) scale(0.6)', opacity: '0' },
          '20%': { opacity: '1' },
          '100%': { transform: 'translate3d(0, -52px, 0) scale(1.05)', opacity: '0' },
        },
        wag: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
      },
      animation: {
        drift: 'drift var(--drift-dur, 26s) linear infinite',
        twinkle: 'twinkle var(--twinkle-dur, 4s) ease-in-out infinite',
        aurora: 'aurora 22s ease-in-out infinite',
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        shine: 'shine 1.1s ease-in-out',
        danmaku: 'danmaku var(--danmaku-dur, 40s) linear infinite',
        'float-up': 'float-up 1.4s ease-out forwards',
        wag: 'wag 1.6s ease-in-out infinite',
      },
      transitionDuration: {
        700: '700ms',
        1000: '1000ms',
      },
      maxWidth: {
        prose: '46rem',
      },
    },
  },
  plugins: [],
} satisfies Config;

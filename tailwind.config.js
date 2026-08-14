/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Основний фон додатку
        base: {
          DEFAULT: '#0a0f1d',
          950: '#0a0f1d',
        },
        // Неоновий акцент (кіберпанк-стиль)
        neon: {
          DEFAULT: '#00f2fe',
          cyan: '#00f2fe',
        },
        // Преміум / VIP акцент
        premium: {
          DEFAULT: '#ffd700',
          gold: '#ffd700',
        },
      },
      backgroundImage: {
        'neon-gradient': 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
        'premium-gradient': 'linear-gradient(135deg, #ffd700 0%, #ffb800 100%)',
      },
      boxShadow: {
        neon: '0 0 20px rgba(0, 242, 254, 0.35)',
        premium: '0 0 20px rgba(255, 215, 0, 0.35)',
      },
      dropShadow: {
        neon: '0 0 8px rgba(0, 242, 254, 0.8)',
        premium: '0 0 8px rgba(255, 215, 0, 0.8)',
      },
      keyframes: {
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 16px rgba(255, 215, 0, 0.3)' },
          '50%': { boxShadow: '0 0 32px rgba(255, 215, 0, 0.7)' },
        },
        'pulse-cyan': {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.08)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'pulse-gold': 'pulse-gold 2.5s ease-in-out infinite',
        'pulse-cyan': 'pulse-cyan 2.5s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

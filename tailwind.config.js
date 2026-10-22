/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}"
  ],
  theme: {
    extend: {
      colors: {
        og: {
          bg: '#090C12',
          surface: '#111621',
          panel: '#171E2E',
          border: '#252F45',
          amber: '#FF7A18',
          citrus: '#FFB347',
          glow: '#FF9238',
          text: '#F3F6FC',
          muted: '#94A3B8'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'monospace']
      }
    }
  },
  plugins: []
};

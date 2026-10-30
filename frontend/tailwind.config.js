export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F3F4F6', ink: '#0E1A2B', rule: '#D8DDE4', sea: { DEFAULT: '#0B6E6E', soft: '#DDF0EE' }, amber: { DEFAULT: '#A85F0B', soft: '#FBEBD0' }, brick: '#B42318',
      },
      fontFamily: { sans: ['"Public Sans"', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};

const c = (n) => `rgb(var(--c-${n}) / <alpha-value>)`;
/** Every colour is a design token (CSS variable) injected by <ThemeProvider/>. */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), surface2: c('surface2'),
        fg: c('fg'), muted: c('muted'), line: c('line'),
        primary: c('primary'), onprimary: c('onprimary'), soft: c('soft'),
        ink: c('ink'), onink: c('onink'),
        danger: c('danger'), success: c('success'),
      },
    },
  },
  plugins: [],
};

const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([
  expo,
  // This existing application does not enable React Compiler. Keep its migration
  // diagnostics visible without treating supported Reanimated mutations as errors.
  { rules: { 'react-hooks/static-components': 'warn', 'react-hooks/set-state-in-effect': 'warn', 'react-hooks/immutability': 'warn' } },
  { ignores: ['dist/**', '.pw/**', '.playwright/**', '.npm-cache/**'] },
]);

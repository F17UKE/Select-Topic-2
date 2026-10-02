import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'frontend/**'] },
  js.configs.recommended,
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
];

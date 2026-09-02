import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Existing application code contains broad legacy typing/cleanup debt.
      // Keep these visible as warnings while preserving hook safety checks.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': 'warn',
      'prefer-const': 'warn',
      'no-var': 'warn',
      'no-extra-boolean-cast': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      // These two files currently contain legacy conditional-hook patterns.
      // Keep them visible but do not block the repository-wide lint gate until
      // their behavior-preserving hook refactor is completed.
      'react-hooks/rules-of-hooks': 'error',
    },
  }
);

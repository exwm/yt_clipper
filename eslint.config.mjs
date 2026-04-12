// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // --- Disabled: impractical with noImplicitAny: false in tsconfig ---
      // Re-enable these when the codebase adopts noImplicitAny: true
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // --- Relaxed: allow common patterns ---
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowAny: true },
      ],
      '@typescript-eslint/restrict-plus-operands': [
        'error',
        { allowNumberAndString: true, allowAny: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'off', // many intentional defensive checks
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions', 'methods'] },
      ],
      '@typescript-eslint/no-dynamic-delete': 'off', // dynamic property deletion is intentional
      '@typescript-eslint/no-unsafe-function-type': 'off', // callback params typed as Function
      '@typescript-eslint/unbound-method': 'off', // method references used intentionally
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  // Ignore test files and mocks (excluded from tsconfig project service)
  {
    ignores: [
      '**/*.test.ts',
      '**/__mocks__/**',
    ],
  },
);

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import litPlugin from 'eslint-plugin-lit';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import tseslint from 'typescript-eslint';
import noUrlAttributeInterpolation from './eslint-rules/no-url-attribute-interpolation';

const localPlugin = {
  rules: {
    'no-url-attribute-interpolation': noUrlAttributeInterpolation,
  },
};

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: {
      lit: litPlugin,
      'no-unsanitized': noUnsanitized as any,
      local: localPlugin as any,
    },
    rules: {
      // From `lit/flat/recommended`.
      'lit/attribute-value-entities': 'error',
      'lit/binding-positions': 'error',
      'lit/no-duplicate-template-bindings': 'error',
      'lit/no-invalid-html': 'error',
      'lit/no-legacy-template-syntax': 'error',
      'lit/no-property-change-update': 'error',
      // Extras beyond recommended.
      // Enforce the XSS defense-in-depth invariant: use .value=${x}, not value=${x}.
      'lit/no-value-attribute': 'error',
      // Prefer `nothing` over empty strings / undefined for empty slots.
      'lit/prefer-nothing': 'error',
      // Forbid .bind(this) in templates — use closure binding instead.
      'lit/no-template-bind': 'error',

      // --- XSS defense-in-depth (post-DOMPurify removal) ---
      // Block raw HTML parser sinks: innerHTML/outerHTML/insertAdjacentHTML/document.write/eval.
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      // Block dynamic values in URL-context attributes in lit templates — lit-html doesn't
      // strip dangerous schemes (javascript:/data:) like DOMPurify did.
      'local/no-url-attribute-interpolation': 'error',
      // Block lit escape-hatch directives that would reopen the HTML parser.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lit-html/directives/unsafe-html.js',
              importNames: ['unsafeHTML'],
              message:
                'unsafeHTML reopens the HTML parser — port the source to a lit-html template instead.',
            },
            {
              name: 'lit-html/directives/unsafe-svg.js',
              importNames: ['unsafeSVG'],
              message: 'unsafeSVG reopens the SVG parser — port the source to a lit-html template.',
            },
            {
              name: 'lit-html/static.js',
              message:
                'Static HTML composition bypasses lit-html structural safety. Use normal bindings.',
            },
            {
              name: 'lit/directives/unsafe-html.js',
              importNames: ['unsafeHTML'],
              message:
                'unsafeHTML reopens the HTML parser — port the source to a lit-html template instead.',
            },
            {
              name: 'lit/directives/unsafe-svg.js',
              importNames: ['unsafeSVG'],
              message: 'unsafeSVG reopens the SVG parser — port the source to a lit-html template.',
            },
            {
              name: 'lit/static-html.js',
              message:
                'Static HTML composition bypasses lit-html structural safety. Use normal bindings.',
            },
          ],
        },
      ],
      // Catch unsafeHTML/unsafeSVG calls by identifier, even if the import is renamed or aliased.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='unsafeHTML']",
          message: 'unsafeHTML is forbidden in this codebase.',
        },
        {
          selector: "CallExpression[callee.name='unsafeSVG']",
          message: 'unsafeSVG is forbidden in this codebase.',
        },
      ],
    },
  },
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
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions', 'methods'] }],
      '@typescript-eslint/no-dynamic-delete': 'off', // dynamic property deletion is intentional
      '@typescript-eslint/no-unsafe-function-type': 'off', // callback params typed as Function
      '@typescript-eslint/unbound-method': 'off', // method references used intentionally
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  // Ignore test files and mocks (excluded from tsconfig project service)
  {
    ignores: ['**/*.test.ts', '**/__mocks__/**'],
  },
);

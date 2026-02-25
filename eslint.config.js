// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript-ESLint recommended rules (type-aware not used to keep it fast)
  ...tseslint.configs.recommended,

  // Disable rules that conflict with Prettier
  eslintConfigPrettier,

  // Project-specific rule overrides
  {
    rules: {
      // Warn on console.log but allow console.warn and console.error
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Relax rules that are too strict for practical use
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)

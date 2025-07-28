import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                global: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                fetch: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_', 'caughtErrorsIgnorePattern': '^_' }],
            'no-console': 'off',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single'],
            'indent': ['error', 4],
            'no-trailing-spaces': 'error',
            'eol-last': 'error'
        }
    },
    {
        ignores: [
            'node_modules/',
            'logs/',
            'test/.tasks/',
            '*.md'
        ]
    }
];

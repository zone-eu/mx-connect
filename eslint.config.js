'use strict';

const globals = require('globals');
const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');

module.exports = [
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'script',
            globals: {
                ...globals.node,
                ...globals.es6,
                it: true,
                describe: true,
                beforeEach: true,
                afterEach: true
            }
        },
        rules: {
            'for-direction': 'error',
            'no-await-in-loop': 'error',
            'no-div-regex': 'error',
            strict: ['error', 'global'],
            eqeqeq: 'error',
            'dot-notation': 'error',
            curly: 'error',
            'no-fallthrough': 'error',
            'quote-props': ['error', 'as-needed'],
            'no-unused-expressions': [
                'error',
                {
                    allowShortCircuit: true
                }
            ],
            'no-unused-vars': 'error',
            'no-new': 'error',
            'new-cap': 'error',
            'no-eval': 'error',
            'no-invalid-this': 'error',
            radix: ['error', 'always'],
            'no-use-before-define': ['error', 'nofunc'],
            'no-regex-spaces': 'error',
            'no-empty': 'error',
            'no-duplicate-case': 'error',
            'no-empty-character-class': 'error',
            'no-redeclare': [
                'error',
                {
                    builtinGlobals: true
                }
            ],
            'block-scoped-var': 'error',
            'no-sequences': 'error',
            'no-throw-literal': 'error',
            'no-useless-call': 'error',
            'no-useless-concat': 'error',
            'no-void': 'error',
            yoda: 'error',
            'no-undef': 'error',
            'no-var': 'error',
            'no-bitwise': 'error',
            'no-lonely-if': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'arrow-parens': ['error', 'as-needed'],
            'prefer-arrow-callback': 'error',
            'object-shorthand': 'error',
            'prefer-spread': 'error'
        }
    },
    {
        ignores: ['node_modules/**']
    }
];

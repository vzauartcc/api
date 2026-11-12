import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const recommended = tseslint.configs.recommended;

const prettier = eslintConfigPrettier;

export default defineConfig([
	{
		ignores: ['**/dist', '**/*.js'],
	},
	...recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},

			ecmaVersion: 2024,
			sourceType: 'module',

			parserOptions: {
				ecmaFeatures: {
					impliedStrict: true,
				},
			},
		},

		rules: {
			'no-dupe-else-if': 'error',
			'no-template-curly-in-string': 'error',
			'array-callback-return': 'error',
			'block-scoped-var': 'error',
			curly: ['error', 'multi-line'],
			'class-methods-use-this': 'error',
			'default-case': 'error',
			eqeqeq: 'error',
			'no-caller': 'error',
			'no-case-declarations': 'error',
			'no-constructor-return': 'error',
			'no-eq-null': 'error',
			'no-eval': 'error',
			'no-extend-native': 'error',
			'no-extra-label': 'error',
			'no-implied-eval': 'error',
			'no-iterator': 'error',
			'no-lone-blocks': 'error',
			'no-loop-func': 'error',
			'no-multi-spaces': 'error',
			'no-multi-str': 'error',
			'no-new': 'error',
			'no-new-func': 'error',
			'no-new-wrappers': 'error',
			'no-octal-escape': 'error',
			'no-proto': 'error',
			'no-return-assign': 'error',
			'no-return-await': 'error',
			'no-script-url': 'error',
			'no-self-compare': 'error',
			'no-sequences': 'error',
			'no-unmodified-loop-condition': 'error',
			'wrap-iife': ['error', 'inside'],
			'vars-on-top': 'error',
			'no-undef': 'error',

			indent: [
				'error',
				'tab',
				{
					SwitchCase: 1,
				},
			],

			'key-spacing': [
				'error',
				{
					beforeColon: false,
					afterColon: true,
				},
			],

			semi: 'error',
			yoda: 'error',

			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],

			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	prettier,
]);

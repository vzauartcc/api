import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

export default defineConfig([
	{
		extends: compat.extends('eslint:recommended'),

		ignores: ['**/dist', '**/*.js'],

		languageOptions: {
			globals: {
				...globals.node,
			},

			ecmaVersion: 2021,
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
		},
	},
]);

import DOMPurify from 'isomorphic-dompurify';

export function sanitizeInput(input: string): string {
	return DOMPurify.sanitize(input, {
		FORBID_TAGS: [
			'input',
			'script',
			'textarea',
			'form',
			'button',
			'select',
			'meta',
			'style',
			'link',
			'title',
			'object',
			'base',
		],
	});
}

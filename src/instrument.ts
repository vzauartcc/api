import * as Sentry from '@sentry/node';

Sentry.init({
	dsn: process.env['SENTRY_DSN'] || '',
	tracesSampleRate: 1.0,
	sendDefaultPii: true,
	beforeSend(event, hint) {
		const error = hint.originalException;

		if (error instanceof Error && error.name === 'JsonWebTokenError') {
			return null;
		}

		if (error instanceof Error && 'code' in error && 'message' in error) {
			return null;
		}

		return event;
	},
});

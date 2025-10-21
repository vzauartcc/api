import * as Sentry from '@sentry/node';

export interface SentryClient {
	captureException(e: unknown): void;

	captureMessage(m: string): void;
}

export const SentryWrapper: SentryClient = {
	captureException: (e: unknown) => {
		Sentry.captureException(e);
	},
	captureMessage: (m: string) => {
		Sentry.captureMessage(m);
	},
};

export const NoOpSentryWrapper: SentryClient = {
	captureException: () => {},
	captureMessage: () => {},
};

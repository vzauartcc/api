export interface SentryClient {
	captureException(e: unknown): void;

	captureMessage(m: string): void;
}

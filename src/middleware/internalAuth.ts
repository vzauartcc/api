import { captureMessage } from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import status from '../types/status.js';

export default function (req: Request, res: Response, next: NextFunction) {
	if (isKeyValid(req)) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isKeyValid(req: Request): boolean {
	if (!process.env['MICRO_ACCESS_KEY']) {
		captureMessage('MICRO_ACCESS_KEY not set.');

		req.internal = false;
		return false;
	}

	const key = req.headers.authorization;

	if (!key || key !== `Bearer ${process.env['MICRO_ACCESS_KEY']}`) {
		captureMessage('Attempted access to an internal protected route');

		req.internal = false;
		return false;
	}

	req.internal = true;
	return true;
}

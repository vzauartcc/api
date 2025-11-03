import { captureMessage } from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import status from '../types/status.js';

export default function (req: Request, res: Response, next: NextFunction) {
	if (!process.env['MICRO_ACCESS_KEY']) {
		return res.status(status.UNAUTHORIZED);
	}

	if (
		!req.headers.authorization ||
		req.headers.authorization !== `Bearer ${process.env['MICRO_ACCESS_KEY']}`
	) {
		captureMessage('Attempted access to an internal protected route');

		return res.status(status.FORBIDDEN);
	}

	return next();
}

import * as Sentry from '@sentry/node';
import { captureMessage } from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import status from '../types/status.js';

export default function (req: Request, res: Response, next: NextFunction) {
	setupSentry(req);

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

function setupSentry(req: Request) {
	const ips = req.headers['x-original-forwarded-for'];
	let clientIp = req.ip;

	if (typeof ips === 'string') {
		clientIp = ips?.split(',')[0]?.trim() || req.ip;
	}

	const user: Sentry.User = {
		ip_address: clientIp ?? null,
	};

	if (req.user) {
		user.id = -1;
		user.username = `Internal Application`;
	}

	Sentry.setUser(user);
	Sentry.getCurrentScope().setUser(user);
}

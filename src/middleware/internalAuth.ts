import * as Sentry from '@sentry/node';
import { captureMessage } from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { IApplication } from '../types/CustomRequest.js';
import status from '../types/status.js';

interface InternalAuthPayload {
	sub: string;
	iat: number;
	exp: number;
}

export default function (req: Request, res: Response, next: NextFunction) {
	setupSentry(req);

	if (isKeyValid(req)) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function jwtInternalAuth(req: Request, res: Response, next: NextFunction) {
	if (!isJwtValid(req)) {
		setupSentry(req);

		return res.status(status.FORBIDDEN).json();
	}

	setupSentry(req);

	return next();
}

export function isJwtValid(req: Request): boolean {
	if (!process.env['MICRO_ACCESS_KEY']) {
		captureMessage('MICRO_ACCESS_KEY not set.');

		req.internal = false;
		req.application = null as unknown as IApplication;

		return false;
	}

	const key = req.headers.authorization?.replace('Bearer ', '');

	if (!key) {
		captureMessage('Attempted access to an internal protected route');
		req.internal = false;
		req.application = null as unknown as IApplication;

		return false;
	}

	try {
		const decoded = jwt.verify(key, process.env['MICRO_ACCESS_KEY']) as InternalAuthPayload;

		if (decoded.exp && decoded.iat) {
			const lifespan = decoded.exp - decoded.iat;
			const age = Math.floor(Date.now() / 1000) - decoded.iat;

			if (lifespan > 60) {
				captureMessage('Attempted access to an internal protected route with a short-lived key');
				req.internal = false;
				req.application = null as unknown as IApplication;

				return false;
			}

			if (age > 65) {
				captureMessage(
					'Attempted access to an internal protected route with a key that is too old',
				);
				req.internal = false;
				req.application = null as unknown as IApplication;

				return false;
			}
		}

		req.application = {
			name: decoded.sub,
		} as unknown as IApplication;
		req.internal = true;

		return true;
	} catch (e) {
		req.internal = false;
		req.application = null as unknown as IApplication;

		return false;
	}
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
		user.username = req.application ? req.application.name : `Internal Application`;
	}

	Sentry.setUser(user);
	Sentry.getCurrentScope().setUser(user);
}

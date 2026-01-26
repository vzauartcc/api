import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import zau from '../helpers/zau.js';
import type { IUser } from '../models/user.js';
import { UserModel } from '../models/user.js';
import status from '../types/status.js';

export interface UserPayload {
	cid: number;
	iat: number;
	exp: number;
}

export default async function (req: Request, res: Response, next: NextFunction) {
	if (!(await isUserValid(req))) {
		deleteAuthCookie(res);
		setupSentry(req);

		return res.status(status.FORBIDDEN).json();
	}

	setupSentry(req);

	if (!req.user) {
		return res.status(status.FORBIDDEN).json();
	}

	return next();
}

function setupSentry(req: Request) {
	const ips = req.headers['x-original-forwarded-for'];
	let clientIp = req.ip;

	if (typeof ips === 'string') {
		clientIp = ips?.split(',')[0]?.trim() || req.ip;
	}

	if (req.user) {
		Sentry.setUser({
			id: req.user.cid,
			username: `${req.user.fname} ${req.user.lname}`,
			ip_address: clientIp ?? null,
		});
	} else {
		Sentry.setUser({
			ip_address: clientIp ?? null,
		});
	}
}

export async function isUserValid(req: Request) {
	const cookie = zau.isProd ? 'token' : 'dev-token';
	const token = req.cookies[cookie];
	if (!token || token.trim() === '') {
		return false;
	}

	if (!process.env['JWT_SECRET']) {
		return false;
	}

	try {
		const decoded = jwt.verify(token, process.env['JWT_SECRET']) as UserPayload;

		const user = await UserModel.findOne({ cid: decoded.cid })
			.populate([
				{
					path: 'roles',
					options: {
						sort: { order: 'asc' },
					},
				},
			])
			.lean({ virtuals: true })
			.cache('10 minutes', `auth-${decoded.cid}`)
			.exec();

		if (!user) {
			return false;
		}

		req.user = user as unknown as IUser;

		return true;
	} catch (err) {
		return false;
	}
}

export function deleteAuthCookie(res: Response) {
	const cookie = zau.isProd ? 'token' : 'dev-token';
	res.cookie(cookie, '', {
		httpOnly: true,
		maxAge: 0,
		sameSite: true,
		domain: process.env['DOMAIN'],
	});
}

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { IUser } from '../models/user.js';
import { UserModel } from '../models/user.js';
import status from '../types/status.js';

export interface UserPayload {
	cid: number;
	iat: number;
	exp: number;
}

export default async function (req: Request, res: Response, next: NextFunction) {
	const userToken = req.cookies['token'] || '';

	if (!userToken || userToken === '') {
		return res.status(status.UNAUTHORIZED).json();
	}

	if (!process.env['JWT_SECRET']) {
		return res.status(status.INTERNAL_SERVER_ERROR).json();
	}

	try {
		const decoded = jwt.verify(userToken, process.env['JWT_SECRET']) as UserPayload;

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
			.exec();

		if (!user) {
			delete req.user;
			deleteAuthCookie(res);

			return res.status(status.FORBIDDEN).json();
		}

		req.user = user as unknown as IUser;
	} catch (err) {
		delete req.user;
		deleteAuthCookie(res);
	} finally {
		return next();
	}
}

export function deleteAuthCookie(res: Response) {
	res.cookie('token', '', {
		httpOnly: true,
		maxAge: 0,
		sameSite: true,
		domain: process.env['DOMAIN'],
	});
}

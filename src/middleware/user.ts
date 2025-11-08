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
	if (!(await isUserValid(req))) {
		deleteAuthCookie(res);

		return res.status(status.FORBIDDEN).json();
	}

	if (!req.user) {
		return res.status(status.FORBIDDEN).json();
	}

	return next();
}

export async function isUserValid(req: Request) {
	const token = req.cookies['token'];
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
	res.cookie('token', '', {
		httpOnly: true,
		maxAge: 0,
		sameSite: true,
		domain: process.env['DOMAIN'],
	});
}

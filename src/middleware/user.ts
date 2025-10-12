import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from 'models/user.js';

export interface UserPayload {
	cid: number;
	iat: number;
	exp: number;
}

export default async function (req: Request, res: Response, next: NextFunction) {
	const userToken = req.cookies.token || '';

	if (!userToken || userToken === '') {
		res.stdRes.ret_det = {
			code: 401,
			message: 'Not authorized.',
		};

		return res.json(res.stdRes);
	}

	if (!process.env.JWT_SECRET) {
		res.stdRes.ret_det = {
			code: 500,
			message: 'Internal Server Error.',
		};

		return res.json(res.stdRes);
	}

	try {
		const decoded = jwt.verify(userToken, process.env.JWT_SECRET) as UserPayload;

		const user = await UserModel.findOne({ cid: decoded.cid })
			.populate([
				{
					path: 'roles',
					options: {
						sort: { order: 'asc' },
					},
				},
			])
			.lean({ virtuals: true });

		if (!user) {
			delete req.user;
			deleteAuthCookie(res);

			res.stdRes.ret_det = {
				code: 403,
				message: 'Not authorized...',
			};

			return res.json(res.stdRes);
		}

		req.user = user;
	} catch (err) {
		delete req.user;
		deleteAuthCookie(res);
	} finally {
		next();
	}
}

export function deleteAuthCookie(res: Response) {
	res.cookie('token', '', {
		httpOnly: true,
		maxAge: 0,
		sameSite: true,
		domain: process.env.DOMAIN,
	});
}

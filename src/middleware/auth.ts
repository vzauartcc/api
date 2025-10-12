import type { NextFunction, Request, Response } from 'express';

export function hasRole(roles: string[]) {
	return function (req: Request, res: Response, next: NextFunction) {
		if (!req.user) {
			req.app.Sentry.captureMessage('Attempted access to an auth route without being logged in.');

			res.stdRes.ret_det = {
				code: 401,
				message: 'Not authorized.',
			};

			return res.json(res.stdRes);
		}

		const roleCodes = req.user.roleCodes;

		const hasPermission = roles.some((r) => roleCodes.includes(r));
		if (!hasPermission) {
			req.app.Sentry.captureMessage(
				`${req.user.cid} attempted to access an auth route without having necessary role.`,
			);
			res.stdRes.ret_det = {
				code: 403,
				message: 'Not authorized.',
			};

			return res.json(res.stdRes);
		}
		next();
	};
}

export function isSelf(req: Request, res: Response, next: NextFunction) {
	if (!req.user || !req.params.id || req.user.cid.toString() !== req.params.id) {
		res.stdRes.ret_det = {
			code: 403,
			message: 'Not authorized',
		};

		return res.json(res.stdRes);
	}

	next();
}

export function isInstructor(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isIns) {
		return next();
	}

	res.stdRes.ret_det = {
		code: 403,
		message: 'Not authorized.',
	};

	return res.json(res.stdRes);
}

export function isStaff(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isStaff) {
		return next();
	}

	res.stdRes.ret_det = {
		code: 403,
		message: 'Not authorized.',
	};

	return res.json(res.stdRes);
}

export function isSeniorStaff(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isSeniorStaff) {
		return next();
	}

	res.stdRes.ret_det = {
		code: 403,
		message: 'Not authorized.',
	};

	return res.json(res.stdRes);
}

export function isManagement(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isManagement) {
		return next();
	}

	res.stdRes.ret_det = {
		code: 403,
		message: 'Not authorized.',
	};

	return res.json(res.stdRes);
}

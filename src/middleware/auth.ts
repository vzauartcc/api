import { captureMessage } from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import status from '../types/status.js';
import { isKeyValid } from './internalAuth.js';
import { isUserValid } from './user.js';

export async function userOrInternal(req: Request, res: Response, next: NextFunction) {
	if (isKeyValid(req)) {
		return next();
	}

	if (await isUserValid(req)) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function hasRole(roles: string[]) {
	return function (req: Request, res: Response, next: NextFunction) {
		if (!req.user) {
			return res.status(status.UNAUTHORIZED).json();
		}

		const roleCodes = req.user.roleCodes;

		const hasPermission = roles.some((r) => roleCodes.includes(r));
		if (!hasPermission) {
			captureMessage(
				`${req.user.cid} attempted to access an auth route without having necessary role.`,
			);

			return res.status(status.FORBIDDEN).json();
		}
		return next();
	};
}

export function isSelf(req: Request, res: Response, next: NextFunction) {
	if (!req.user || !req.params['id'] || req.user.cid.toString() !== req.params['id']) {
		return res.status(status.FORBIDDEN).json();
	}

	return next();
}

export function isNotSelf(managementBypass: boolean = true) {
	return function (req: Request, res: Response, next: NextFunction) {
		if (!req.user) {
			return res.status(status.FORBIDDEN).json();
		}

		const check = req.params['cid'] || req.params['id'];

		if (isNaN(Number(check))) {
			return res.status(status.FORBIDDEN).json();
		}

		if (managementBypass && req.user.isManagement) {
			return next();
		}

		if (req.user.cid.toString() === check) {
			return res.status(status.FORBIDDEN).json();
		}

		return next();
	};
}

export function isMember(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isMember === true) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isTrainingStaff(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isTrainingStaff) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isInstructor(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isInstructor) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isStaff(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isStaff) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isEventsTeam(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isEventsTeam) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isFacilityTeam(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isFacilityTeam) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isSeniorStaff(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isSeniorStaff) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

export function isManagement(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.isManagement) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

import { captureMessage } from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';

export default function (req: Request, res: Response, next: NextFunction) {
	if (!process.env['MICRO_ACCESS_KEY']) {
		res.stdRes.ret_det = {
			code: 500,
			message: 'Internal Server Error.',
		};

		return res.json(res.stdRes);
	}
	if (
		!req.headers.authorization ||
		req.headers.authorization !== `Bearer ${process.env['MICRO_ACCESS_KEY']}`
	) {
		captureMessage('Attempted access to an internal protected route');
		res.stdRes.ret_det = {
			code: 400,
			message: 'Not authorized.',
		};

		return res.json(res.stdRes);
	}

	return next();
}

import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import status from '../../types/status.js';

const router = Router();

// Default router
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.UNAUTHORIZED).json();
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

export default router;

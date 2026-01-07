import { Router, type NextFunction, type Request, type Response } from 'express';
import { logException } from '../../app.js';
import status from '../../types/status.js';

const router = Router();

// Default router
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.UNAUTHORIZED).json();
	} catch (e) {
		logException(req, e);

		return next(e);
	}
});

export default router;

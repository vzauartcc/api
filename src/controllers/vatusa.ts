import { captureException } from '@sentry/node';
import { Router, type Request, type Response } from 'express';
import { convertToReturnDetails } from '../app.js';

const router = Router();

// Default router
router.get('/', async (_req: Request, res: Response) => {
	try {
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

export default router;

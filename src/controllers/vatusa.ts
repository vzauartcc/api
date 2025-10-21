import { Router, type Request, type Response } from 'express';
import { convertToReturnDetails } from '../app.js';

const router = Router();

// Default router
router.get('/', async (req: Request, res: Response) => {
	try {
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = convertToReturnDetails(e);
	} finally {
		return res.json(res.stdRes);
	}
});

export default router;

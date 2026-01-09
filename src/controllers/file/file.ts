import { Router, type NextFunction, type Request, type Response } from 'express';
import { logException } from '../../app.js';
import { getUploadStatus } from '../../helpers/s3.js';
import status from '../../types/status.js';
import documentsRouter from './documents.js';
import downloadsRouter from './downloads.js';

const router = Router();

router.use('/downloads', downloadsRouter);
router.use('/documents', documentsRouter);

router.get('/checkStatus/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid ID.',
			};
		}

		const progress = getUploadStatus(req.params['id']);

		if (!progress) {
			throw {
				code: status.NOT_FOUND,
				message: 'Not found',
			};
		}

		return res.status(status.OK).json({ progress });
	} catch (e) {
		logException(req, e);

		return next(e);
	}
});

export default router;
